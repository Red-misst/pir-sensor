# IoT People Counter System Deployment Guide

This document provides practical deployment instructions for setting up and configuring the Proximity Alert IoT People Counter system. For detailed technical specifications, please refer to the [Technical Documentation](TECHNICAL_README.md).

## Quick Start

1. **Hardware Setup**
   - Connect PIR sensors to pins D1 (entry) and D2 (exit)
   - Connect LED to pin D5
   - Connect buzzer to pin D6
   - Power the ESP8266 via USB or external 5V supply

2. **Software Deployment**
   - Install Node.js dependencies: `npm install`
   - Upload ESP8266 firmware using Arduino IDE
   - Start the server: `npm start`
   - Access dashboard: http://localhost:3000

## Operational Behavior

### Light Control Logic
The system automatically controls lighting based on room occupancy:

- **When someone enters:** LED turns ON (representing room lights)
- **When everyone exits:** LED turns OFF (energy-saving mode)
- **Current occupancy is tracked** and displayed on the dashboard

### Buzzer Alert Function
The buzzer provides audible notifications:

- **Activates when occupancy reaches zero** - a 3-second alert indicating all lights are being turned off
- **Serves as a reminder** that the monitored space is now vacant

## Troubleshooting

### Common Issues

1. **LED not turning on with entries**
   - Check LED wiring connection to pin D5
   - Verify PIR sensor placement and sensitivity settings
   - Ensure ESP8266 is successfully connecting to WiFi

2. **Buzzer not sounding on exits**
   - Check buzzer wiring connection to pin D6
   - Verify occupancy count is properly decrementing to zero
   - Test buzzer directly using the test firmware option

3. **Inaccurate counting**
   - Adjust PIR sensor positions to better capture directional movement
   - Increase the `maxSequenceGap` parameter if entries/exits are too slow
   - Check for reflective surfaces that might trigger false readings

## Maintenance

Regular maintenance ensures optimal system performance:

- Clean PIR sensor lenses monthly
- Update firmware when new versions are available
- Perform monthly system tests to verify counting accuracy
- Check log files for any unusual activity patterns

## Data Management

All entry/exit events are stored in MongoDB for historical analysis:

- Data is organized by date, time, and event type
- Standard retention period is 90 days
- Aggregated historical data is kept indefinitely
- Data can be exported in CSV or JSON format

## Contact Support

For technical assistance:
- Email: support@proximity-alert.com
- Documentation: https://docs.proximity-alert.com
- Community forum: https://community.proximity-alert.com
