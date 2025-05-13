// Simple WebSocket server for ESP8266 occupancy counter
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
// MongoDB would be imported here in a full implementation
// const mongoose = require('mongoose');

// Create express app, HTTP server, and WebSocket server
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Port configuration
const PORT = process.env.PORT || 3000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB connection string (commented as not implemented yet)
// const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/peopleCounter';

// Connect to MongoDB (commented as not implemented yet)
/*
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Create MongoDB Schema (to be implemented)
const EventSchema = new mongoose.Schema({
  eventType: String,      // "entry" or "exit"
  timestamp: Date,        // Event timestamp
  deviceId: String,       // Device identifier
  occupancyAfter: Number  // Total occupancy after event
});

const Event = mongoose.model('Event', EventSchema);
*/

// Store connected clients
const clients = new Set();

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('Client connected');
  clients.add(ws);
    // Message handler
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] Received data: ${JSON.stringify(data)}`);
      
      // Store event in MongoDB (commented as not implemented yet)
      /*
      const eventData = new Event({
        eventType: data.event,
        timestamp: new Date(),
        deviceId: data.deviceId || 'default-device',
        occupancyAfter: data.occupancy || 0
      });
      
      eventData.save()
        .then(() => console.log('Event saved to MongoDB'))
        .catch(err => console.error('Error saving to MongoDB:', err));
      */
      
      // Broadcast the message to all connected clients
      const broadcastData = {
        ...data,
        timestamp
      };
      
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(broadcastData));
        }
      }
    } catch (err) {
      console.error('Error processing message:', err);
      console.log('Raw message:', message.toString());
    }
  });

  // Connection closed handler
  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
  });

  // Error handler
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});