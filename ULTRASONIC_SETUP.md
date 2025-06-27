# Ultrasonic Sensor People Counter - Setup Guide

## Why Ultrasonic Sensors?

This project has been updated to use ultrasonic distance sensors instead of PIR motion sensors for several key improvements:

### Advantages of Ultrasonic Sensors:
- **Precise Distance Measurement**: ±3mm accuracy vs ±1m for PIR sensors
- **Better Directional Detection**: Can determine exact position and movement direction
- **Environmental Stability**: Unaffected by temperature, lighting, or air currents
- **Stationary Detection**: Works even when people aren't moving
- **Real-time Feedback**: Provides actual distance readings for debugging
- **Configurable Zones**: Adjustable detection thresholds

## Hardware Connections

### ESP8266 NodeMCU Pin Connections:

| Component | ESP8266 Pin | Purpose |
|-----------|-------------|---------|
| Entry Sensor Trig | D1 (GPIO5) | Trigger pin for entry detection |
| Entry Sensor Echo | D2 (GPIO4) | Echo pin for entry detection |
| Exit Sensor Trig | D3 (GPIO0) | Trigger pin for exit detection |
| Exit Sensor Echo | D4 (GPIO2) | Echo pin for exit detection |
| LED Control | D5 (GPIO14) | Lighting control output |
| Buzzer | D6 (GPIO12) | Vacancy alert buzzer |
| Power (5V) | VIN | 5V power input |
| Ground | GND | Common ground |

### HC-SR04 Ultrasonic Sensor Connections:
Each sensor needs 4 connections:
- **VCC** → 5V (or 3.3V)
- **GND** → Ground
- **Trig** → ESP8266 trigger pin
- **Echo** → ESP8266 echo pin

## Physical Installation

### Sensor Placement:
1. **Entry Sensor**: Position at the inside edge of the doorway
2. **Exit Sensor**: Position at the outside edge of the doorway
3. **Distance**: Place sensors 60-80cm apart for optimal detection
4. **Height**: Mount at chest height (120-150cm from floor)
5. **Angle**: Point sensors slightly downward (15-20 degrees)

### Detection Algorithm:
- **Entry**: Entry sensor triggers first, then exit sensor
- **Exit**: Exit sensor triggers first, then entry sensor
- **Threshold**: Default detection distance is 100cm (configurable)
- **Timeout**: 3 seconds maximum between sensor triggers

## Software Configuration

### Key Parameters (in Arduino code):
```cpp
const int DETECTION_THRESHOLD = 100;    // Detection distance in cm
const int MIN_DISTANCE = 5;             // Minimum valid reading
const int MAX_DISTANCE = 200;           // Maximum valid reading
const unsigned long maxSequenceGap = 3000;  // Max time between sensors
```

### WiFi Configuration:
Update these lines in the Arduino code:
```cpp
const char* ssid = "YOUR_WIFI_NAME";
const char* password = "YOUR_WIFI_PASSWORD";
```

## Installation Steps

1. **Hardware Setup**:
   - Connect ultrasonic sensors according to pin diagram
   - Connect LED and buzzer outputs
   - Power the ESP8266 via USB or 5V adapter

2. **Software Upload**:
   - Install Arduino IDE
   - Add ESP8266 board support
   - Install required libraries: WebSockets2_Generic, Arduino_JSON
   - Upload the firmware to ESP8266

3. **Server Setup**:
   ```bash
   npm install
   npm start
   ```

4. **Testing**:
   - Open web dashboard at http://localhost:3000
   - Monitor distance readings in real-time
   - Test entry/exit detection by walking through sensors

## Dashboard Features

The web interface now displays:
- **Real-time Distance Readings**: Live distance from both sensors
- **Entry/Exit Counters**: Total counts with distance information
- **Current Occupancy**: Real-time room occupancy
- **Event Log**: Detailed log with distance measurements
- **Occupancy Timeline**: Visual chart of room usage

## Troubleshooting

### Common Issues:
1. **Inaccurate Readings**: 
   - Check sensor mounting angle
   - Verify 5V power supply
   - Adjust DETECTION_THRESHOLD

2. **False Detections**:
   - Increase glitchFilter time
   - Check for reflective surfaces
   - Ensure sensors don't interfere with each other

3. **Missed Detections**:
   - Decrease DETECTION_THRESHOLD
   - Increase maxSequenceGap
   - Check sensor positioning

### Distance Readings:
- **Normal Range**: 10-150cm
- **Detection Zone**: 0-100cm (configurable)
- **Invalid Reading**: -1 or >200cm

## Energy Savings

The ultrasonic system provides more accurate occupancy detection, leading to:
- **Reduced False Positives**: Lights don't stay on unnecessarily
- **Better Vacancy Detection**: More reliable "room empty" detection
- **Precise Control**: Lights turn off exactly when last person exits
- **Usage Analytics**: Detailed room utilization data for optimization

## Future Enhancements

Possible improvements with ultrasonic sensors:
- **Height Detection**: Distinguish between adults/children
- **Speed Analysis**: Measure walking speed for behavior analysis
- **Multiple Zones**: Divide room into detection areas
- **Crowd Counting**: Handle multiple simultaneous entries/exits
