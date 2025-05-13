#include <ESP8266WiFi.h>
#include <WebSockets2_Generic.h>
#include <Arduino_JSON.h>

using namespace websockets2_generic;
// — Pin definitions —
// Use only GPIOs 0,2,4,5,12,13,14,15 on ESP8266 dev‐boards!
const int PIR_IN   = 5;   // D1
const int PIR_OUT  = 4;   // D2
const int LED_PIN  = 14;  // D5
const int BUZZ_PIN = 12;  // D6

// Timing
const unsigned long maxSequenceGap = 3000;  // max ms between sensor hits
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

void updatePulses() {
  unsigned long now = millis();
  for (Pulse* p : { &entryLed, &exitBuzz }) {
    if (p->active && (now - p->startMs >= p->lengthMs)) {
      digitalWrite(p->pin, LOW);
      p->active = false;
    }
  }
}

//— Directional detection state machine —
enum DetectState { IDLE, SAW_IN, SAW_OUT };
DetectState detectState = IDLE;
unsigned long sawTime = 0;

// Forward declare WS client so handleDetection can use it:
WebsocketsClient client;
bool wsConnected = false;

void sendEvent(const char* type) {
  // Build simple JSON
  String payload = String("{\"event\":\"") + type +
                   String("\",\"timestamp\":") + String(millis()) +
                   String(",\"occupancy\":") + String(occupancyCount) +
                   String("}");
  if (wsConnected) {
    client.send(payload);
    Serial.print("WS Sent: ");
    Serial.println(payload);
  }
}

// Called each loop to read PIRs and infer direction
const unsigned long quietWindow = 800;     // ms to ignore after an event
const unsigned long glitchFilter = 100;    // ms minimum between saw and confirm
unsigned long lastEventTime = 0;

void handleDetection() {
  unsigned long now = millis();
  bool inH  = digitalRead(PIR_IN);
  bool outH = digitalRead(PIR_OUT);

  // Suppress too-rapid retriggers
  if (now - lastEventTime < quietWindow) return;

  switch (detectState) {
    case IDLE:
      if (inH) {
        detectState = SAW_IN;
        sawTime = now;
      } else if (outH) {
        detectState = SAW_OUT;
        sawTime = now;
      }
      break;

    case SAW_IN:
      if (outH && (now - sawTime <= maxSequenceGap)
                 && (now - sawTime >= glitchFilter)) {
        // Confirmed entry
        occupancyCount++;
        digitalWrite(LED_PIN, HIGH);  // Turn on lights when occupied
        sendEvent("entry");
        detectState = IDLE;
        lastEventTime = now;
      } else if (now - sawTime > maxSequenceGap) {
        detectState = IDLE;
      }
      break;    case SAW_OUT:
      if (inH && (now - sawTime <= maxSequenceGap)
                && (now - sawTime >= glitchFilter)) {
        // Confirmed exit
        if (occupancyCount > 0) {
          occupancyCount--;
        }
        
        if (occupancyCount == 0) {
          digitalWrite(LED_PIN, LOW);  // Turn off lights when vacant
          triggerPulse(exitBuzz);      // Activate buzzer
        }
        
        sendEvent("exit");
        detectState = IDLE;
        lastEventTime = now;
      } else if (now - sawTime > maxSequenceGap) {
        detectState = IDLE;
      }
      break;
  }
}


// — Wi-Fi & WebSocket setup —
// WiFi  Config
const char* ssid = "Tenda_5C30C8";
const char* password = "op898989..";

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

// WebSocket server details
const char* ws_server = "192.168.0.109";
const uint16_t ws_port = 3000;

// WebSocket event callback
void onEventsCallback(WebsocketsEvent event, String data) {
  switch (event) {
    case WebsocketsEvent::ConnectionOpened:
      Serial.println("[WS] Connection Opened");
      wsConnected = true;
      client.send("Client Connected");
      break;
    case WebsocketsEvent::ConnectionClosed:
      Serial.println("[WS] Connection Closed, reconnecting...");
      wsConnected = false;
      break;
    case WebsocketsEvent::GotPing:
      Serial.println("[WS] Received Ping!");
      break;
    case WebsocketsEvent::GotPong:
      Serial.println("[WS] Received Pong!");
      break;
  }
}


// Function to connect to WebSocket
void connectToWebSocket() {
  if (!WiFi.isConnected()) return;
  Serial.println("Connecting to WebSocket server...");
  client.setInsecure();
  client.onEvent(onEventsCallback);
  String url = String("ws://") + ws_server + ":" + String(ws_port) + "/";
  if (client.connect(url)) {
    Serial.println("[WS] Connected");
  } else {
    Serial.println("[WS] Connection failed");
  }
}

void setup() {
  Serial.begin(115200);

  // Pins
  pinMode(PIR_IN, INPUT);
  pinMode(PIR_OUT, INPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZ_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);  // Ensure LED starts off
  digitalWrite(BUZZ_PIN, LOW);
  
  // Initialize counters
  occupancyCount = 0;

  // Let PIRs settle
  Serial.println("Warming up PIR sensors for 5s...");
  unsigned long start = millis();
  while (millis() - start < 5000) {
    yield();
  }
  Serial.println("Ready");

  // **Connect WiFi first, then WS**
  connectToWiFi();
  connectToWebSocket();
}

void loop() {
  // Keep WiFi & WS alive
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi lost, reconnecting...");
    connectToWiFi();
  }
  if (!wsConnected) {
    Serial.println("WS lost, reconnecting...");
    connectToWebSocket();
  }

  // Poll WebSocket for incoming messages/pings
  if (client.available()) {
    client.poll();
  }

  // Run detection + output pulses
  handleDetection();
  updatePulses();

  yield();  // watchdog
}
