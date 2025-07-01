// Simple WebSocket server for ESP8266 occupancy counter
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Create express app and HTTP server
const app = express();
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ 
  server, 
  path: '/',
  // Improved WebSocket server options for production
  clientTracking: true,
  // Increase timeout values for production stability
  pingTimeout: 120000,
  pingInterval: 30000,
  // Add verification for secure WebSocket connections
  verifyClient: (info, cb) => {
    // Optional: Add client verification logic here
    // Example: check origin, authentication tokens, etc.
    cb(true); // Accept all connections for now
  }
});

// Port configuration
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/proximity_alert';

// MongoDB connection
let db;
let occupancyCollection;
let eventsCollection;

// Connect to MongoDB
async function connectToMongoDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db();
    occupancyCollection = db.collection('occupancy');
    eventsCollection = db.collection('events');
    
    // Initialize occupancy if it doesn't exist
    const existingOccupancy = await occupancyCollection.findOne({ deviceId: 'proximity_sensor_01' });
    if (!existingOccupancy) {
      await occupancyCollection.insertOne({
        deviceId: 'proximity_sensor_01',
        currentOccupancy: 0,
        lastUpdated: new Date(),
        lightsOn: false
      });
    }
    
    console.log('Connected to MongoDB successfully');
  } catch (error) {
    console.error('MongoDB connection failed:', error);
    process.exit(1);
  }
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Track different types of clients
const clients = {
  browsers: new Set(),
  sensors: new Map(),
  esp8266: new Set()
};

// Store latest sensor data
let latestSensorData = {
  occupancy: 0,
  entryDistance: -1,
  exitDistance: -1,
  lastUpdate: null,
  lightsOn: false
};

// Express routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to get current occupancy status
app.get('/api/status', async (req, res) => {
  try {
    const occupancyData = await occupancyCollection.findOne({ deviceId: 'proximity_sensor_01' });
    res.json({
      success: true,
      data: {
        occupancy: occupancyData?.currentOccupancy || 0,
        lightsOn: occupancyData?.lightsOn || false,
        lastUpdate: occupancyData?.lastUpdated || null
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to get events history
app.get('/api/events', async (req, res) => {
  try {
    const { limit = 50, skip = 0 } = req.query;
    const events = await eventsCollection
      .find({ deviceId: 'proximity_sensor_01' })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .toArray();
    
    res.json({
      success: true,
      events: events,
      count: events.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Function to send command to ESP8266
function sendCommandToESP8266(command) {
  for (const client of clients.esp8266) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(command));
        console.log('Command sent to ESP8266:', command);
      } catch (err) {
        console.error('Error sending command to ESP8266:', err);
      }
    }
  }
}

// Function to update occupancy and control lights/buzzer
async function updateOccupancy(eventType, deviceId, sensorData) {
  try {
    const currentData = await occupancyCollection.findOne({ deviceId });
    let newOccupancy = currentData?.currentOccupancy || 0;
    
    if (eventType === 'entry') {
      newOccupancy++;
    } else if (eventType === 'exit') {
      newOccupancy = Math.max(0, newOccupancy - 1);
    }
    
    const lightsOn = newOccupancy > 0;
    
    // Update MongoDB
    await occupancyCollection.updateOne(
      { deviceId },
      {
        $set: {
          currentOccupancy: newOccupancy,
          lastUpdated: new Date(),
          lightsOn: lightsOn
        }
      },
      { upsert: true }
    );
    
    // Log event
    await eventsCollection.insertOne({
      deviceId,
      eventType,
      timestamp: new Date(),
      occupancyBefore: currentData?.currentOccupancy || 0,
      occupancyAfter: newOccupancy,
      entryDistance: sensorData.entryDistance,
      exitDistance: sensorData.exitDistance,
      lightsOn: lightsOn
    });
    
    // Send light control command to ESP8266
    if (eventType === 'entry' && newOccupancy === 1) {
      // Turn lights on when first person enters
      sendCommandToESP8266({
        type: 'light_control',
        action: 'on',
        reason: 'first_entry'
      });
    } else if (eventType === 'exit' && newOccupancy === 0) {
      // Turn lights off when last person exits
      sendCommandToESP8266({
        type: 'light_control',
        action: 'off',
        reason: 'all_exited'
      });
      
      // Trigger vacancy alert buzzer
      sendCommandToESP8266({
        type: 'buzzer_control',
        action: 'trigger',
        reason: 'vacancy_alert'
      });
    }
    
    // Update latest sensor data
    latestSensorData = {
      occupancy: newOccupancy,
      entryDistance: sensorData.entryDistance || -1,
      exitDistance: sensorData.exitDistance || -1,
      lastUpdate: new Date().toISOString(),
      lightsOn: lightsOn,
      event: eventType,
      deviceId: deviceId
    };
    
    console.log(`[${new Date().toISOString()}] ${eventType.toUpperCase()} - Occupancy: ${newOccupancy}, Lights: ${lightsOn ? 'ON' : 'OFF'}`);
    
    // Broadcast to browsers
    broadcastToBrowsers({
      type: 'occupancy_update',
      event: eventType,
      occupancy: newOccupancy,
      entryDistance: sensorData.entryDistance,
      exitDistance: sensorData.exitDistance,
      timestamp: latestSensorData.lastUpdate,
      lightsOn: lightsOn,
      deviceId: deviceId
    });
    
    return { occupancy: newOccupancy, lightsOn };
    
  } catch (error) {
    console.error('Error updating occupancy:', error);
    return null;
  }
}

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  
  const url = new URL(`http://localhost${req.url}`);
  const clientType = url.searchParams.get('type') || 'browser';
  const deviceId = url.searchParams.get('id') || `device-${Date.now()}`;

  console.log(`New ${clientType} connection from ${clientIp}`);

  // Send immediate acknowledgement
  try {
    ws.send(JSON.stringify({
      type: 'connection_ack',
      message: 'Connected to proximity alert server',
      timestamp: Date.now(),
      clientType: clientType
    }));
  } catch (err) {
    console.error('Error sending connection acknowledgement:', err);
  }

  // Set up ping interval
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      // Check if client hasn't responded for too long
      if (Date.now() - ws.lastHeartbeat > 90000) {
        clearInterval(pingInterval);
        return ws.terminate();
      }
      
      // Send ping
      try {
        ws.ping();
      } catch (err) {
        // Handle ping error
        console.error('Error sending ping:', err);
        ws.terminate();
      }
    }
  }, 30000);

  // Handle client type assignment
  if (clientType === 'browser') {
    clients.browsers.add(ws);
    console.log(`Browser client connected. Total browsers: ${clients.browsers.size}`);
    
    // Send latest data to new browser client
    if (latestSensorData.lastUpdate) {
      ws.send(JSON.stringify({
        type: 'sensor_data',
        data: latestSensorData
      }));
    }
    
    // Send recent critical messages
    if (global.recentMessages && global.recentMessages.length > 0) {
      // Small delay to ensure client is ready
      setTimeout(() => {
        try {
          ws.send(JSON.stringify({
            type: 'recent_messages',
            count: global.recentMessages.length,
            timestamp: Date.now()
          }));
          
          // Send each message individually
          global.recentMessages.forEach(item => {
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                try {
                  ws.send(item.message);
                } catch (err) {
                  console.error('Error sending recent message:', err);
                }
              }
            }, 100);
          });
        } catch (err) {
          console.error('Error sending message history:', err);
        }
      }, 1000);
    }
  } else if (clientType === 'esp8266' || clientType === 'sensor') {
    clients.esp8266.add(ws);
    clients.sensors.set(deviceId, ws);
    console.log(`ESP8266 ${deviceId} connected. Total ESP8266 devices: ${clients.esp8266.size}`);
    
    // Send configuration to ESP8266
    try {
      ws.send(JSON.stringify({
        type: 'config',
        timestamp: Date.now(),
        interval: 500,  // Suggest measurement interval
        server_time: new Date().toISOString()
      }));
    } catch (err) {
      console.error('Error sending config to ESP8266:', err);
    }
  }

  // Set last heartbeat time
  ws.isAlive = true;
  ws.lastHeartbeat = Date.now();

  // Handle incoming messages
  ws.on('message', async (message) => {
    try {
      const messageString = message.toString();
      
      if (messageString === "Client Connected") {
        console.log(`${clientType} device connected and sent hello message`);
        // Send acknowledgment with timestamp for better sync
        ws.send(JSON.stringify({
          type: 'connection_confirmed',
          timestamp: Date.now(),
          server_time: new Date().toISOString()
        }));
        return;
      }
      
      let data;
      try {
        data = JSON.parse(messageString);
        console.log(`Received from ${clientType}:`, data);
      } catch (parseError) {
        console.error('Error parsing message:', parseError);
        console.error('Raw message:', messageString);
        // Send error response to client
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid JSON format',
          timestamp: Date.now()
        }));
        return;
      }
      
      // Message validation
      if (!data || typeof data !== 'object') {
        console.error('Invalid message format:', data);
        return;
      }
      
      // Handle ESP8266 detection events with improved validation
      if (data.event && (data.event === 'entry' || data.event === 'exit')) {
        const sensorData = {
          entryDistance: typeof data.entryDistance === 'number' ? data.entryDistance : -1,
          exitDistance: typeof data.exitDistance === 'number' ? data.exitDistance : -1
        };
        
        const result = await updateOccupancy(data.event, data.deviceId || deviceId, sensorData);
        
        if (result) {
          console.log(`Processed ${data.event} - New occupancy: ${result.occupancy}`);
          // Send acknowledgment to ESP8266
          ws.send(JSON.stringify({
            type: 'event_processed',
            event: data.event,
            timestamp: Date.now(),
            success: true
          }));
        } else {
          console.error(`Failed to process ${data.event} event`);
          ws.send(JSON.stringify({
            type: 'event_processed',
            event: data.event,
            timestamp: Date.now(),
            success: false,
            message: 'Failed to update occupancy'
          }));
        }
      }
      // Handle sensor measurements with improved validation
      else if (data.type === 'sensor_measurements') {
        // Validate required fields
        if (typeof data.timestamp === 'undefined' ||
            typeof data.entryDistance === 'undefined' ||
            typeof data.exitDistance === 'undefined') {
          console.error('Invalid sensor measurements format:', data);
          return;
        }
        
        // Store latest measurements for new clients
        Object.assign(latestSensorData, {
          entryDistance: data.entryDistance || latestSensorData.entryDistance,
          exitDistance: data.exitDistance || latestSensorData.exitDistance,
          lastUpdate: new Date().toISOString(),
          deviceId: data.deviceId || deviceId
        });
        
        // Broadcast to browsers with retry mechanism
        broadcastToBrowsersWithRetry({
          type: 'sensor_measurements',
          ...data,
          server_received: Date.now()
        });
      }
      // Handle test session control
      else if (data.type === 'test_session_control') {
        let response = {
          type: 'test_session_response',
          success: true,
          action: data.action
        };
        
        try {
          if (data.action === 'start') {
            // Send command to ESP8266 to start test session
            sendCommandToESP8266({
              type: 'test_mode',
              enabled: true
            });
            console.log('Test session started');
          } else if (data.action === 'stop') {
            // Send command to ESP8266 to stop test session
            sendCommandToESP8266({
              type: 'test_mode',
              enabled: false
            });
            console.log('Test session stopped');
          }
        } catch (error) {
          response.success = false;
          response.message = error.message;
          console.error('Error handling test session:', error);
        }
        
        ws.send(JSON.stringify(response));
      }
      // Handle reset occupancy
      else if (data.type === 'reset_occupancy') {
        let response = {
          type: 'reset_occupancy_response',
          success: true
        };
        
        try {
          // Reset occupancy in MongoDB
          await occupancyCollection.updateOne(
            { deviceId: 'proximity_sensor_01' },
            {
              $set: {
                currentOccupancy: 0,
                lastUpdated: new Date(),
                lightsOn: false
              }
            }
          );
          
          // Log the reset event
          await eventsCollection.insertOne({
            deviceId: 'proximity_sensor_01',
            eventType: 'manual_reset',
            timestamp: new Date(),
            occupancyBefore: latestSensorData.occupancy,
            occupancyAfter: 0,
            entryDistance: -1,
            exitDistance: -1,
            lightsOn: false
          });
          
          // Update latest sensor data
          latestSensorData.occupancy = 0;
          latestSensorData.lightsOn = false;
          latestSensorData.lastUpdate = new Date().toISOString();
          
          // Send command to ESP8266 to turn off lights
          sendCommandToESP8266({
            type: 'light_control',
            action: 'off',
            reason: 'manual_reset'
          });
          
          // Broadcast update to all browsers
          broadcastToBrowsers({
            type: 'occupancy_update',
            event: 'reset',
            occupancy: 0,
            timestamp: latestSensorData.lastUpdate,
            lightsOn: false,
            deviceId: 'proximity_sensor_01'
          });
          
          console.log('Occupancy count manually reset to zero');
        } catch (error) {
          response.success = false;
          response.message = error.message;
          console.error('Error resetting occupancy count:', error);
        }
        
        ws.send(JSON.stringify(response));
      }
      
    } catch (error) {
      console.error(`Error processing message: ${error.message}`);
      console.error(error.stack);
    }
  });

  // Handle WebSocket close
  ws.on('close', () => {
    clearInterval(pingInterval);
    
    if (clients.browsers.has(ws)) {
      clients.browsers.delete(ws);
      console.log('Browser client disconnected');
    } else if (clients.esp8266.has(ws)) {
      clients.esp8266.delete(ws);
      console.log(`ESP8266 device disconnected`);
      
      for (const [id, sensor] of clients.sensors.entries()) {
        if (sensor === ws) {
          clients.sensors.delete(id);
          console.log(`Sensor ${id} removed`);
          break;
        }
      }
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  ws.on('pong', () => {
    ws.isAlive = true;
    ws.lastHeartbeat = Date.now();
    console.log(`Received pong from ${clientType} client`);
  });
});

function broadcastToBrowsers(message) {
  const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
  const failedClients = [];
  
  for (const client of clients.browsers) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(messageStr);
      } catch (err) {
        console.error('Error broadcasting to browser:', err);
        failedClients.push(client);
      }
    } else if (client.readyState === WebSocket.CLOSED || client.readyState === WebSocket.CLOSING) {
      failedClients.push(client);
    }
  }
  
  // Clean up failed clients
  for (const client of failedClients) {
    clients.browsers.delete(client);
    console.log('Removed closed browser connection during broadcast');
  }
}

// Add a new function for broadcasts with retry
const messageQueue = new Map(); // Map of client -> messages to retry

function broadcastToBrowsersWithRetry(message, maxRetries = 3) {
  broadcastToBrowsers(message);
  
  // For critical messages, we can queue them for offline clients
  // This is optional and depends on your application needs
  if (message.type === 'occupancy_update' || message.type === 'critical_alert') {
    const messageStr = JSON.stringify(message);
    
    // Store this message for clients that connect later
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Store last 10 critical messages
    if (!global.recentMessages) {
      global.recentMessages = [];
    }
    
    global.recentMessages.unshift({
      id: messageId,
      message: messageStr,
      timestamp: Date.now()
    });
    
    // Keep only the last 10 messages
    if (global.recentMessages.length > 10) {
      global.recentMessages.pop();
    }
  }
}

// Server error handling
server.on('error', (error) => {
  console.error(`Server error: ${error.message}`);
});

// Initialize and start server
async function startServer() {
  await connectToMongoDB();
  
  server.listen(PORT, () => {
    console.log(`Proximity Alert Server listening on port ${PORT}`);
    console.log(`WebSocket server ready for connections`);
    console.log(`Access the dashboard at http://localhost:${PORT}`);
    console.log(`MongoDB connected and ready`);
  });
}

startServer().catch(console.error);

// Connection monitoring for production stability
const connectionMonitor = setInterval(() => {
  console.log(`Active connections - Browsers: ${clients.browsers.size}, ESP8266: ${clients.esp8266.size}`);
  
  // Check all clients for dead connections
  for (const client of [...clients.browsers, ...clients.esp8266]) {
    if (client.readyState !== WebSocket.OPEN) {
      console.log('Found dead connection, cleaning up...');
      
      if (clients.browsers.has(client)) {
        clients.browsers.delete(client);
      }
      
      if (clients.esp8266.has(client)) {
        clients.esp8266.delete(client);
        
        for (const [id, sensor] of clients.sensors.entries()) {
          if (sensor === client) {
            clients.sensors.delete(id);
            console.log(`Sensor ${id} removed due to dead connection`);
            break;
          }
        }
      }
    }
  }
}, 60000); // Check every minute

// Ensure the interval is cleared on server shutdown
process.on('SIGINT', async () => {
  console.log('Received SIGINT. Graceful shutdown...');
  clearInterval(connectionMonitor);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM. Graceful shutdown...');
  clearInterval(connectionMonitor);
  process.exit(0);
});