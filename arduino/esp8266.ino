#include <ESP8266WiFi.h>
#include <WebSockets2_Generic.h>
#include <Arduino_JSON.h>

using namespace websockets2_generic;

// — Pin definitions for Ultrasonic Sensors —
// Entry sensor (inside to outside direction)
const int ENTRY_TRIG = 5;   // D1 - Trigger pin for entry sensor
const int ENTRY_ECHO = 4;   // D2 - Echo pin for entry sensor
// Exit sensor (outside to inside direction)  
const int EXIT_TRIG = 13;   // D7 - Trigger pin for exit sensor
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
const unsigned long loggingInterval = 5000;    // ms between sensor data logs
unsigned long lastMeasurement = 0;
unsigned long lastLogging = 0;

// Sensor measurement tracking
struct SensorData {
  long entryDistance = -1;
  long exitDistance = -1;
  unsigned long timestamp = 0;
  bool entryDetected = false;
  bool exitDetected = false;
};

SensorData currentSensorData;

// Pulse struct for buzzer
struct Pulse {
  int     pin;
  bool    active   = false;
  uint32_t startMs = 0;
  uint32_t lengthMs = 3000;
};
Pulse exitBuzz = { BUZZ_PIN };

void triggerPulse(Pulse &p) {
  if (!p.active) {
    digitalWrite(p.pin, HIGH);
    p.startMs = millis();
    p.active = true;
  }
}

void updatePulses() {
  unsigned long now = millis();
  if (exitBuzz.active && (now - exitBuzz.startMs >= exitBuzz.lengthMs)) {
    digitalWrite(exitBuzz.pin, LOW);
    exitBuzz.active = false;
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

//— Directional detection state machine using ultrasonic sensors —
enum DetectState { IDLE, SAW_ENTRY, SAW_EXIT };
DetectState detectState = IDLE;
unsigned long sawTime = 0;

// WebSocket client
WebsocketsClient client;
bool wsConnected = false;
unsigned long lastWsReconnectAttempt = 0;
const unsigned long wsReconnectInterval = 5000;
int wsReconnectAttempts = 0;
const int maxWsReconnectAttempts = 10;

void sendDetectionEvent(const char* type) {
  // Only send detection events with sensor data - no counting
  String payload = String("{\"event\":\"") + type +
                   String("\",\"timestamp\":") + String(millis()) +
                   String(",\"entryDistance\":") + String(currentSensorData.entryDistance) +
                   String(",\"exitDistance\":") + String(currentSensorData.exitDistance) +
                   String(",\"deviceId\":\"proximity_sensor_01\"") +
                   String("}");
  if (wsConnected) {
    client.send(payload);
    Serial.print("Detection Sent: ");
    Serial.println(payload);
  }
}

// Send periodic sensor measurements
void sendSensorMeasurements() {
  if (!wsConnected) return;
  
  String payload = String("{\"type\":\"sensor_measurements\"") +
                   String(",\"timestamp\":") + String(currentSensorData.timestamp) +
                   String(",\"entryDistance\":") + String(currentSensorData.entryDistance) +
                   String(",\"exitDistance\":") + String(currentSensorData.exitDistance) +
                   String(",\"entryDetected\":") + (currentSensorData.entryDetected ? "true" : "false") +
                   String(",\"exitDetected\":") + (currentSensorData.exitDetected ? "true" : "false") +
                   String(",\"detectState\":\"") + 
                   (detectState == IDLE ? "IDLE" : (detectState == SAW_ENTRY ? "SAW_ENTRY" : "SAW_EXIT")) +
                   String("\"") + // Add closing quote for detectState
                   String(",\"deviceId\":\"proximity_sensor_01\"") +
                   String("}");
  
  client.send(payload);
}

// Log sensor measurements to serial
void logSensorMeasurements() {
  Serial.println("=== Sensor Measurements ===");
  Serial.print("Entry Distance: ");
  Serial.print(currentSensorData.entryDistance);
  Serial.print(" cm (");
  Serial.print(currentSensorData.entryDetected ? "DETECTED" : "clear");
  Serial.println(")");
  Serial.print("Exit Distance: ");
  Serial.print(currentSensorData.exitDistance);
  Serial.print(" cm (");
  Serial.print(currentSensorData.exitDetected ? "DETECTED" : "clear");
  Serial.println(")");
  Serial.print("State: ");
  Serial.println(detectState == IDLE ? "IDLE" : (detectState == SAW_ENTRY ? "SAW_ENTRY" : "SAW_EXIT"));
  Serial.println("===========================");
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
  
  // Measure distances from both sensors and update current data
  currentSensorData.entryDistance = measureDistance(ENTRY_TRIG, ENTRY_ECHO);
  currentSensorData.exitDistance = measureDistance(EXIT_TRIG, EXIT_ECHO);
  currentSensorData.timestamp = now;
  currentSensorData.entryDetected = isPersonDetected(currentSensorData.entryDistance);
  currentSensorData.exitDetected = isPersonDetected(currentSensorData.exitDistance);

  // Periodic logging
  if (now - lastLogging >= loggingInterval) {
    lastLogging = now;
    logSensorMeasurements();
    sendSensorMeasurements();
  }

  // Suppress too-rapid retriggers
  if (now - lastEventTime < quietWindow) return;

  switch (detectState) {
    case IDLE:
      if (currentSensorData.entryDetected) {
        detectState = SAW_ENTRY;
        sawTime = now;
        Serial.println("Entry sensor triggered");
      } else if (currentSensorData.exitDetected) {
        detectState = SAW_EXIT;
        sawTime = now;
        Serial.println("Exit sensor triggered");
      }
      break;

    case SAW_ENTRY:
      if (currentSensorData.exitDetected && (now - sawTime <= maxSequenceGap)
                       && (now - sawTime >= glitchFilter)) {
        // Confirmed entry - send detection event only
        sendDetectionEvent("entry");
        Serial.println("Entry confirmed - sent to server");
        detectState = IDLE;
        lastEventTime = now;
      } else if (now - sawTime > maxSequenceGap) {
        Serial.println("Entry timeout - returning to idle");
        detectState = IDLE;
      }
      break;

    case SAW_EXIT:
      if (currentSensorData.entryDetected && (now - sawTime <= maxSequenceGap)
                        && (now - sawTime >= glitchFilter)) {
        // Confirmed exit - send detection event only
        sendDetectionEvent("exit");
        Serial.println("Exit confirmed - sent to server");
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
const char* ssid = "Tenda_5C30C8";
const char* password = "op898989..";
const char* ws_server = "192.168.0.109";
const uint16_t ws_port = 3000;

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

void connectToWebSocket() {
  if (!WiFi.isConnected()) {
    Serial.println("[WS] WiFi not connected, skipping WebSocket connection");
    return;
  }
  
  unsigned long now = millis();
  
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
  
  if (client.available()) {
    client.close();
  }
  
  client.onEvent(onEventsCallback);
  client.onMessage(onMessageCallback);
  client.setTimeout(10000);
  
  String url = String("ws://") + ws_server + ":" + String(ws_port) + "/?type=esp8266&id=proximity_sensor_01";
  
  Serial.print("Connecting to: ");
  Serial.println(url);
  
  if (client.connect(url)) {
    Serial.println("[WS] Connection initiated");
  } else {
    Serial.println("[WS] Connection failed");
    wsConnected = false;
    
    if (wsReconnectAttempts >= maxWsReconnectAttempts) {
      Serial.println("[WS] Max reconnection attempts reached, waiting 30 seconds...");
      lastWsReconnectAttempt = now + 25000;
      wsReconnectAttempts = 0;
    }
  }
}

void onEventsCallback(WebsocketsEvent event, String data) {
  switch (event) {
    case WebsocketsEvent::ConnectionOpened:
      Serial.println("[WS] Connection Opened");
      wsConnected = true;
      wsReconnectAttempts = 0;
      client.send("Client Connected");
      break;
    case WebsocketsEvent::ConnectionClosed:
      Serial.println("[WS] Connection Closed");
      wsConnected = false;
      break;
    case WebsocketsEvent::GotPing:
      Serial.println("[WS] Received Ping!");
      client.pong();
      break;
    case WebsocketsEvent::GotPong:
      Serial.println("[WS] Received Pong!");
      break;
  }
}

// Handle commands from server
void onMessageCallback(WebsocketsMessage message) {
  Serial.print("[WS] Received: ");
  Serial.println(message.data());
  
  // Parse JSON commands from server
  JSONVar command = JSON.parse(message.data());
  
  if (JSON.typeof(command) != "undefined") {
    if (command.hasOwnProperty("type")) {
      String commandType = (const char*)command["type"];
      
      if (commandType == "light_control") {
        String action = (const char*)command["action"];
        if (action == "on") {
          digitalWrite(LED_PIN, HIGH);
          Serial.println("Light turned ON by server command");
        } else if (action == "off") {
          digitalWrite(LED_PIN, LOW);
          Serial.println("Light turned OFF by server command");
        }
      } else if (commandType == "buzzer_control") {
        String action = (const char*)command["action"];
        if (action == "trigger") {
          triggerPulse(exitBuzz);
          Serial.println("Buzzer triggered by server command");
        }
      }
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
  digitalWrite(LED_PIN, LOW);
  digitalWrite(BUZZ_PIN, LOW);
  
  // Initialize sensor data
  currentSensorData.timestamp = millis();

  Serial.println("Initializing ultrasonic sensors for 3s...");
  delay(3000);
  Serial.println("Ultrasonic sensors ready - Detection only mode");
  Serial.println("Pin Configuration:");
  Serial.println("- Entry Trigger: D1 (GPIO5)");
  Serial.println("- Entry Echo: D2 (GPIO4)");
  Serial.println("- Exit Trigger: D7 (GPIO13)");
  Serial.println("- Exit Echo: D4 (GPIO2)");
  Serial.println("- LED: D5 (GPIO14) - Server controlled");
  Serial.println("- Buzzer: D6 (GPIO12) - Server controlled");

  connectToWiFi();
  connectToWebSocket();
}

void loop() {
  // Keep WiFi alive
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi lost, reconnecting...");
    wsConnected = false;
    connectToWiFi();
  }
  
  // Attempt WebSocket reconnection if needed
  if (!wsConnected) {
    connectToWebSocket();
  }

  // Poll WebSocket for incoming messages/pings
  if (wsConnected && client.available()) {
    client.poll();
    
    if (!client.available()) {
      Serial.println("[WS] Connection lost during poll");
      wsConnected = false;
    }
  }
  
  // Send periodic ping to keep connection alive
  static unsigned long lastPing = 0;
  unsigned long now = millis();
  if (wsConnected && (now - lastPing > 30000)) {
    client.ping();
    lastPing = now;
  }

  // Run detection and update pulses
  handleDetection();
  updatePulses();

  yield();
}