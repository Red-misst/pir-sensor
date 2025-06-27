#include <ESP8266WiFi.h>
#include <WebSockets2_Generic.h>
#include <Arduino_JSON.h>

using namespace websockets2_generic;

// — Pin definitions for Ultrasonic Sensors —
// Entry sensor (inside to outside direction)
const int ENTRY_TRIG = 5;   // D1 - Trigger pin for entry sensor
const int ENTRY_ECHO = 4;   // D2 - Echo pin for entry sensor
// Exit sensor (outside to inside direction)  
const int EXIT_TRIG = 0;    // D3 - Trigger pin for exit sensor
const int EXIT_ECHO = 2;    // D4 - Echo pin for exit sensor

const int LED_PIN  = 14;    // D5 - LED control
const int BUZZ_PIN = 12;    // D6 - Buzzer

// Ultrasonic sensor parameters
const int DETECTION_THRESHOLD = 100;    // Distance in cm to detect person
const int MIN_DISTANCE = 5;             // Minimum valid distance reading
const int MAX_DISTANCE = 200;           // Maximum valid distance reading

// Timing parameters
const unsigned long maxSequenceGap = 3000;  // max ms between sensor hits
const unsigned long measurementInterval = 100; // ms between distance measurements
unsigned long lastMeasurement = 0;
unsigned long lastStateTime = 0;

// Global occupancy counter
int occupancyCount = 0;

// Pulse struct & instances
struct Pulse {
  int     pin;
  bool    active   = false;
  uint32_t startMs = 0;
  uint32_t lengthMs = 3000;
};
Pulse entryLed  = { LED_PIN };
Pulse exitBuzz  = { BUZZ_PIN };

void triggerPulse(Pulse &p) {
  if (!p.active) {
    digitalWrite(p.pin, HIGH);
    p.startMs = millis();
    p.active  = true;
  }
}

// Distance measurement function
long measureDistance(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  
  long duration = pulseIn(echoPin, HIGH, 30000); // 30ms timeout
  if (duration == 0) return -1; // No echo received
  
  long distance = duration * 0.034 / 2; // Convert to cm
  
  // Filter out invalid readings
  if (distance < MIN_DISTANCE || distance > MAX_DISTANCE) {
    return -1;
  }
  
  return distance;
}

// Check if person is detected at given distance
bool isPersonDetected(long distance) {
  return (distance > 0 && distance <= DETECTION_THRESHOLD);
}

void updatePulses() {
  unsigned long now = millis();
  for (Pulse* p : { &entryLed, &exitBuzz }) {
    if (p->active && (now - p->startMs >= p->lengthMs)) {
      digitalWrite(p->pin, LOW);
      p->active = false;
    }
  }
}

//— Directional detection state machine using ultrasonic sensors —
enum DetectState { IDLE, SAW_ENTRY, SAW_EXIT };
DetectState detectState = IDLE;
unsigned long sawTime = 0;

// Forward declare WS client so handleDetection can use it:
WebsocketsClient client;
bool wsConnected = false;
unsigned long lastWsReconnectAttempt = 0;
const unsigned long wsReconnectInterval = 5000; // 5 seconds between reconnection attempts
int wsReconnectAttempts = 0;
const int maxWsReconnectAttempts = 10;

void sendEvent(const char* type) {
  // Measure current distances for reporting
  long entryDist = measureDistance(ENTRY_TRIG, ENTRY_ECHO);
  long exitDist = measureDistance(EXIT_TRIG, EXIT_ECHO);
  
  // Build JSON with sensor data
  String payload = String("{\"event\":\"") + type +
                   String("\",\"timestamp\":") + String(millis()) +
                   String(",\"occupancy\":") + String(occupancyCount) +
                   String(",\"entryDistance\":") + String(entryDist) +
                   String(",\"exitDistance\":") + String(exitDist) +
                   String("}");
  if (wsConnected) {
    client.send(payload);
    Serial.print("WS Sent: ");
    Serial.println(payload);
  }
}

// Called each loop to read ultrasonic sensors and infer direction
const unsigned long quietWindow = 800;     // ms to ignore after an event
const unsigned long glitchFilter = 200;    // ms minimum between saw and confirm
unsigned long lastEventTime = 0;

void handleDetection() {
  unsigned long now = millis();
  
  // Only measure at defined intervals to avoid sensor interference
  if (now - lastMeasurement < measurementInterval) return;
  lastMeasurement = now;
  
  // Measure distances from both sensors
  long entryDistance = measureDistance(ENTRY_TRIG, ENTRY_ECHO);
  long exitDistance = measureDistance(EXIT_TRIG, EXIT_ECHO);
  
  bool entryDetected = isPersonDetected(entryDistance);
  bool exitDetected = isPersonDetected(exitDistance);

  // Suppress too-rapid retriggers
  if (now - lastEventTime < quietWindow) return;

  switch (detectState) {
    case IDLE:
      if (entryDetected) {
        detectState = SAW_ENTRY;
        sawTime = now;
        Serial.println("Entry sensor triggered");
      } else if (exitDetected) {
        detectState = SAW_EXIT;
        sawTime = now;
        Serial.println("Exit sensor triggered");
      }
      break;

    case SAW_ENTRY:
      if (exitDetected && (now - sawTime <= maxSequenceGap)
                       && (now - sawTime >= glitchFilter)) {
        // Confirmed entry (entry sensor then exit sensor)
        occupancyCount++;
        digitalWrite(LED_PIN, HIGH);  // Turn on lights when occupied
        sendEvent("entry");
        Serial.print("Entry confirmed! Occupancy: ");
        Serial.println(occupancyCount);
        detectState = IDLE;
        lastEventTime = now;
      } else if (now - sawTime > maxSequenceGap) {
        Serial.println("Entry timeout - returning to idle");
        detectState = IDLE;
      }
      break;

    case SAW_EXIT:
      if (entryDetected && (now - sawTime <= maxSequenceGap)
                        && (now - sawTime >= glitchFilter)) {
        // Confirmed exit (exit sensor then entry sensor)
        if (occupancyCount > 0) {
          occupancyCount--;
        }
        
        if (occupancyCount == 0) {
          digitalWrite(LED_PIN, LOW);  // Turn off lights when vacant
          triggerPulse(exitBuzz);      // Activate buzzer
        }
        
        sendEvent("exit");
        Serial.print("Exit confirmed! Occupancy: ");
        Serial.println(occupancyCount);
        detectState = IDLE;
        lastEventTime = now;
      } else if (now - sawTime > maxSequenceGap) {
        Serial.println("Exit timeout - returning to idle");
        detectState = IDLE;
      }
      break;
  }
}


// — Wi-Fi & WebSocket setup —
// WiFi  Config
const char* ssid = "Tenda_5C30C8";
const char* password = "op898989..";

// WebSocket server details
const char* ws_server = "pir-sensor.onrender.com";  // New server URL without https:// prefix
const uint16_t ws_port = 443;  // Default HTTPS/WSS port

// Function to connect to WiFi
void connectToWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(ssid, password);
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 20) {
    delay(500);
    Serial.print(".");
    retries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nFailed to connect to WiFi!");
  }
}

// WebSocket event callback
void onEventsCallback(WebsocketsEvent event, String data) {
  switch (event) {
    case WebsocketsEvent::ConnectionOpened:
      Serial.println("[WS] Connection Opened");
      wsConnected = true;
      wsReconnectAttempts = 0; // Reset attempts counter on successful connection
      client.send("Client Connected");
      break;
    case WebsocketsEvent::ConnectionClosed:
      Serial.println("[WS] Connection Closed");
      wsConnected = false;
      break;
    case WebsocketsEvent::GotPing:
      Serial.println("[WS] Received Ping!");
      client.pong(); // Respond to ping to maintain connection
      break;
    case WebsocketsEvent::GotPong:
      Serial.println("[WS] Received Pong!");
      break;
  }
}

// Function to connect to WebSocket
void connectToWebSocket() {
  if (!WiFi.isConnected()) {
    Serial.println("[WS] WiFi not connected, skipping WebSocket connection");
    return;
  }
  
  unsigned long now = millis();
  
  // Check if we should attempt reconnection based on interval and attempt limits
  if (wsConnected || 
      (now - lastWsReconnectAttempt < wsReconnectInterval) || 
      (wsReconnectAttempts >= maxWsReconnectAttempts)) {
    return;
  }
  
  lastWsReconnectAttempt = now;
  wsReconnectAttempts++;
  
  Serial.print("Connecting to WebSocket server... (attempt ");
  Serial.print(wsReconnectAttempts);
  Serial.print("/");
  Serial.print(maxWsReconnectAttempts);
  Serial.println(")");
  
  // Close any existing connection
  if (client.available()) {
    client.close();
  }
  
  client.setInsecure();  // Required for SSL without certificate validation
  client.onEvent(onEventsCallback);
  
  // Set connection timeout
  client.setTimeout(10000); // 10 second timeout
  
  String url = String("wss://") + ws_server + "/";  // Using secure WebSocket with wss:// prefix
  
  if (client.connect(url)) {
    Serial.println("[WS] Connection initiated");
    // Don't set wsConnected = true here, wait for ConnectionOpened event
  } else {
    Serial.println("[WS] Connection failed");
    wsConnected = false;
    
    // If we've exhausted attempts, wait longer before retrying
    if (wsReconnectAttempts >= maxWsReconnectAttempts) {
      Serial.println("[WS] Max reconnection attempts reached, waiting 30 seconds...");
      lastWsReconnectAttempt = now + 25000; // Add extra 25 seconds (total 30 with interval)
      wsReconnectAttempts = 0; // Reset attempts after long wait
    }
  }
}

void setup() {
  Serial.begin(115200);

  // Configure pins for ultrasonic sensors
  pinMode(ENTRY_TRIG, OUTPUT);
  pinMode(ENTRY_ECHO, INPUT);
  pinMode(EXIT_TRIG, OUTPUT);
  pinMode(EXIT_ECHO, INPUT);
  
  // Configure output pins
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZ_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);  // Ensure LED starts off
  digitalWrite(BUZZ_PIN, LOW);
  
  // Initialize counters
  occupancyCount = 0;

  // Let sensors settle
  Serial.println("Initializing ultrasonic sensors for 3s...");
  delay(3000);
  Serial.println("Ultrasonic sensors ready");

  // **Connect WiFi first, then WS**
  connectToWiFi();
  connectToWebSocket();
}

void loop() {
  // Keep WiFi alive
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi lost, reconnecting...");
    wsConnected = false; // Mark WebSocket as disconnected when WiFi is lost
    connectToWiFi();
  }
  
  // Attempt WebSocket reconnection if needed
  if (!wsConnected) {
    connectToWebSocket();
  }

  // Poll WebSocket for incoming messages/pings and check connection health
  if (wsConnected && client.available()) {
    client.poll();
    
    // Check if connection is actually still alive
    if (!client.available()) {
      Serial.println("[WS] Connection lost during poll");
      wsConnected = false;
    }
  }
  
  // Send periodic ping to keep connection alive
  static unsigned long lastPing = 0;
  unsigned long now = millis();
  if (wsConnected && (now - lastPing > 30000)) { // Ping every 30 seconds
    client.ping();
    lastPing = now;
  }

  // Run detection + output pulses
  handleDetection();
  updatePulses();

  yield();  // watchdog
}