// Simple WebSocket server for ESP8266 occupancy counter
const express = require('express');
const http = require('http');
const https = require('https');
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

// Store connected clients
const clients = new Set();

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('Client connected');
  clients.add(ws);
  
  // Message handler
  ws.on('message', (message) => {
    const messageString = message.toString();
    
    // Check if the message is a simple connection message
    if (messageString === "Client Connected") {
      console.log("Device connected and sent hello message");
      return;
    }
    
    // Try to parse as JSON for event messages
    try {
      const data = JSON.parse(messageString);
      
      // Ensure we have an event and timestamp from ESP8266
      // If timestamp is missing, we'll add it
      const timestamp = data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString();
      
      console.log(`[${timestamp}] Received event: ${data.event}, Occupancy: ${data.occupancy}`);
      
      // Broadcast the message to all connected clients
      const broadcastData = {
        event: data.event,
        timestamp: timestamp,
        occupancy: data.occupancy || 0
      };
      
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(broadcastData));
        }
      }
    } catch (err) {
      console.error('Error processing message:', err);
      console.log('Raw message:', messageString);
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