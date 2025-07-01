// State variables
let entryCount = 0;
let exitCount = 0;
let currentCount = 0;

// DOM elements
const connectionStatus = document.getElementById('connection-status');
const entryCountElement = document.getElementById('entry-count');
const exitCountElement = document.getElementById('exit-count');
const currentCountElement = document.getElementById('current-count');
const entryDistanceElement = document.getElementById('entry-distance');
const exitDistanceElement = document.getElementById('exit-distance');
const eventLog = document.getElementById('event-log');
const clearLogButton = document.getElementById('clear-log');
const testSessionBtn = document.getElementById('test-session-btn');
const resetOccupancyBtn = document.getElementById('reset-occupancy-btn');
const testSessionText = document.getElementById('test-session-text');
const testSessionSpinner = document.getElementById('test-session-spinner');
const resetOccupancySpinner = document.getElementById('reset-occupancy-spinner');

// Chart.js theme setup
Chart.defaults.color = 'rgba(255, 255, 255, 0.75)';
Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.1)';
Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// Initialize Chart
const ctx = document.getElementById('occupancyChart').getContext('2d');
const chart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'Occupancy',
                data: [],
                borderColor: '#00b3ff',
                backgroundColor: 'rgba(0, 179, 255, 0.1)',
                tension: 0.4,
                fill: true,
                borderWidth: 2
            },
            {
                label: 'Entries',
                data: [],
                borderColor: '#00b3ff',
                backgroundColor: '#00b3ff',
                pointStyle: 'circle',
                pointRadius: 6,
                pointHoverRadius: 8,
                showLine: false
            },
            {
                label: 'Exits',
                data: [],
                borderColor: '#ff3b5c',
                backgroundColor: '#ff3b5c',
                pointStyle: 'circle',
                pointRadius: 6,
                pointHoverRadius: 8,
                showLine: false
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'index',
            intersect: false,
        },
        plugins: {
            legend: {
                position: 'top',
                labels: {
                    usePointStyle: true,
                    padding: 20,
                    font: {
                        size: 12
                    }
                }
            },
            tooltip: {
                backgroundColor: 'rgba(30, 30, 30, 0.8)',
                titleFont: {
                    size: 14,
                    weight: 'normal'
                },
                bodyFont: {
                    size: 13
                },
                padding: 12,
                cornerRadius: 8,
                displayColors: true,
                usePointStyle: true,
                callbacks: {
                    title: function(context) {
                        return context[0].label;
                    }
                }
            }
        },
        scales: {
            x: {
                grid: {
                    display: false
                },
                ticks: {
                    maxRotation: 0,
                    autoSkip: true,
                    maxTicksLimit: 10,
                    font: {
                        size: 11
                    }
                }
            },
            y: {
                beginAtZero: true,
                suggestedMax: 5,
                grid: {
                    color: 'rgba(255, 255, 255, 0.05)'
                },
                ticks: {
                    precision: 0,
                    font: {
                        size: 11
                    }
                }
            }
        },
        elements: {
            point: {
                radius: 0
            }
        }
    }
});

// WebSocket connection
const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const wsUrl = `${protocol}${window.location.host}`;
let socket;

function connectWebSocket() {
    socket = new WebSocket(wsUrl);
    
    socket.onopen = function() {
        connectionStatus.innerHTML = '<span class="badge-ios">Connected</span>';
        clearFirstLogItemIfDefault();
        
        // Load initial data
        loadInitialData();
    };
    
    socket.onclose = function() {
        connectionStatus.innerHTML = '<span class="badge-ios badge-danger">Disconnected</span>';
        
        // Try to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
    };
    
    socket.onerror = function(error) {
        console.error('WebSocket error:', error);
        connectionStatus.innerHTML = '<span class="badge-ios badge-warning">Connection Error</span>';
    };
    
    socket.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            console.log('Received data:', data);
            
            // Handle different message types
            if (data.type === 'occupancy_update') {
                handleOccupancyUpdate(data);
            } else if (data.type === 'sensor_measurements') {
                updateSensorReadings(data);
            } else if (data.type === 'sensor_data') {
                // Initial data load
                if (data.data) {
                    updateDisplayFromData(data.data);
                }
            } else if (data.type === 'test_session_response') {
                // Handle test session response
                testSessionSpinner.classList.add('d-none');
                testSessionBtn.disabled = false;
                testSessionText.textContent = isTestSessionActive ? 'Stop Test Session' : 'Start Test Session';
                testSessionBtn.classList.toggle('btn-primary', !isTestSessionActive);
                testSessionBtn.classList.toggle('btn-warning', isTestSessionActive);
                
                if (data.success) {
                    showToast('Success', `Test session ${isTestSessionActive ? 'started' : 'stopped'}`, 'success');
                } else {
                    showToast('Error', data.message || 'Failed to control test session', 'danger');
                    isTestSessionActive = !isTestSessionActive; // Revert state
                }
            } else if (data.type === 'reset_occupancy_response') {
                // Handle reset occupancy response
                resetOccupancySpinner.classList.add('d-none');
                resetOccupancyBtn.disabled = false;
                
                if (data.success) {
                    // Update UI to reflect reset
                    const prevCount = currentCount;
                    currentCount = 0;
                    animateValue(currentCountElement, prevCount, currentCount, 300);
                    
                    // Update chart
                    const timeString = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
                    updateChart(timeString, 'reset');
                    
                    showToast('Success', 'Occupancy count reset to zero', 'success');
                } else {
                    showToast('Error', data.message || 'Failed to reset occupancy count', 'danger');
                }
            }
            
        } catch (err) {
            console.error('Error processing message:', err);
        }
    };
}

// Load initial data from API
async function loadInitialData() {
    try {
        const response = await fetch('/api/status');
        const result = await response.json();
        
        if (result.success) {
            updateDisplayFromData(result.data);
        }
    } catch (error) {
        console.error('Error loading initial data:', error);
    }
}

// Update display from data object
function updateDisplayFromData(data) {
    currentCount = data.occupancy || 0;
    currentCountElement.textContent = currentCount;
    
    if (data.entryDistance !== undefined && entryDistanceElement) {
        entryDistanceElement.textContent = data.entryDistance > 0 ? `${data.entryDistance} cm` : '-- cm';
    }
    if (data.exitDistance !== undefined && exitDistanceElement) {
        exitDistanceElement.textContent = data.exitDistance > 0 ? `${data.exitDistance} cm` : '-- cm';
    }
}

// Handle occupancy updates from server
function handleOccupancyUpdate(data) {
    // Update distance displays
    if (data.entryDistance !== undefined && entryDistanceElement) {
        entryDistanceElement.textContent = data.entryDistance > 0 ? `${data.entryDistance} cm` : '-- cm';
    }
    if (data.exitDistance !== undefined && exitDistanceElement) {
        exitDistanceElement.textContent = data.exitDistance > 0 ? `${data.exitDistance} cm` : '-- cm';
    }
    
    // Format timestamp for display
    const timestamp = new Date(data.timestamp);
    const timeString = timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
    
    // Process event data
    if (data.event === 'entry') {
        entryCount++;
        const prevCount = currentCount;
        currentCount = data.occupancy;
        updateChart(timeString, 'entry');
        logEvent(timeString, `Entry detected (${data.entryDistance}cm → ${data.exitDistance}cm) - Server counted`, 'entry');
        
        // Add animation effect to the counter
        animateValue(entryCountElement, entryCount - 1, entryCount, 300);
        animateValue(currentCountElement, prevCount, currentCount, 300);
    } else if (data.event === 'exit') {
        exitCount++;
        const prevCount = currentCount;
        currentCount = data.occupancy;
        updateChart(timeString, 'exit');
        logEvent(timeString, `Exit detected (${data.exitDistance}cm → ${data.entryDistance}cm) - Server counted`, 'exit');
        
        // Add animation effect to the counter
        animateValue(exitCountElement, exitCount - 1, exitCount, 300);
        animateValue(currentCountElement, prevCount, currentCount, 300);
    }
}

// Update sensor readings without affecting counts
function updateSensorReadings(data) {
    if (data.entryDistance !== undefined && entryDistanceElement) {
        entryDistanceElement.textContent = data.entryDistance > 0 ? `${data.entryDistance} cm` : '-- cm';
    }
    if (data.exitDistance !== undefined && exitDistanceElement) {
        exitDistanceElement.textContent = data.exitDistance > 0 ? `${data.exitDistance} cm` : '-- cm';
    }
}

// Simple toast notification function
function showToast(title, message, type = 'info') {
    // Create toast container if it doesn't exist
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.className = 'position-fixed bottom-0 end-0 p-3';
        toastContainer.style.zIndex = '11';
        document.body.appendChild(toastContainer);
    }
    
    // Create toast element
    const toastId = `toast-${Date.now()}`;
    const toast = document.createElement('div');
    toast.className = `toast show bg-${type} text-white`;
    toast.id = toastId;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');
    
    // Toast content
    toast.innerHTML = `
        <div class="toast-header bg-${type} text-white">
            <strong class="me-auto">${title}</strong>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
        <div class="toast-body">
            ${message}
        </div>
    `;
    
    // Add to container
    toastContainer.appendChild(toast);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
    
    // Add close button functionality
    const closeBtn = toast.querySelector('.btn-close');
    closeBtn.addEventListener('click', () => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    });
}

// Modified updateChart function to handle reset events
function updateChart(timeLabel, eventType) {
    // Keep only the latest 30 data points
    if (chart.data.labels.length >= 30) {
        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
        
        // Keep entries/exits aligned with labels
        const newEntries = [];
        const newExits = [];
        
        for (let i = 1; i < chart.data.labels.length; i++) {
            newEntries.push(chart.data.datasets[1].data[i]);
            newExits.push(chart.data.datasets[2].data[i]);
        }
        
        chart.data.datasets[1].data = newEntries;
        chart.data.datasets[2].data = newExits;
    }
    
    // Add new timestamp to labels
    chart.data.labels.push(timeLabel);
    
    // Add occupancy data point
    chart.data.datasets[0].data.push(currentCount);
    
    // Add entry or exit point
    const entryPoint = eventType === 'entry' ? currentCount : null;
    const exitPoint = eventType === 'exit' ? currentCount : null;
    
    chart.data.datasets[1].data.push(entryPoint);
    chart.data.datasets[2].data.push(exitPoint);
    
    // Add special marker for reset events
    if (eventType === 'reset') {
        // Highlight reset events as both entry and exit points
        chart.data.datasets[1].data[chart.data.datasets[1].data.length - 1] = currentCount;
        chart.data.datasets[2].data[chart.data.datasets[2].data.length - 1] = currentCount;
    }
    
    // Update the chart with animation
    chart.update();
}

// Clear the default "waiting for events" message
function clearFirstLogItemIfDefault() {
    if (eventLog.firstChild && eventLog.firstChild.textContent.includes('Waiting for events')) {
        eventLog.removeChild(eventLog.firstChild);
    }
}

// Animate value change for counters
function animateValue(element, start, end, duration) {
    if (start === end) return;
    
    // Add highlight effect
    element.style.transition = 'color 0.5s ease-in-out';
    element.style.color = '#00b3ff';
    
    // Set the end value immediately for this simple counter
    element.textContent = end;
    
    // Remove highlight after animation
    setTimeout(() => {
        element.style.transition = 'color 0.5s ease-in-out';
        element.style.color = '';
    }, duration);
}

// Clear log button handler
clearLogButton.addEventListener('click', function() {
    while (eventLog.firstChild) {
        eventLog.removeChild(eventLog.firstChild);
    }
    const defaultMessage = document.createElement('div');
    defaultMessage.className = 'list-group-item text-center text-secondary';
    defaultMessage.textContent = 'Log cleared';
    eventLog.appendChild(defaultMessage);
});

// Test session button handler
testSessionBtn.addEventListener('click', function() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        showToast('Error', 'No connection to server', 'danger');
        return;
    }
    
    // Toggle test session state
    isTestSessionActive = !isTestSessionActive;
    
    // Show spinner
    testSessionSpinner.classList.remove('d-none');
    testSessionBtn.disabled = true;
    
    // Send test session command to server
    socket.send(JSON.stringify({
        type: 'test_session_control',
        action: isTestSessionActive ? 'start' : 'stop'
    }));
    
    // Log the action
    const timeString = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
    logEvent(timeString, `Test session ${isTestSessionActive ? 'started' : 'stopped'}`, isTestSessionActive ? 'entry' : 'exit');
});

// Reset occupancy button handler
resetOccupancyBtn.addEventListener('click', function() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        showToast('Error', 'No connection to server', 'danger');
        return;
    }
    
    if (confirm('Are you sure you want to reset the occupancy count to zero?')) {
        // Show spinner
        resetOccupancySpinner.classList.remove('d-none');
        resetOccupancyBtn.disabled = true;
        
        // Send reset command to server
        socket.send(JSON.stringify({
            type: 'reset_occupancy'
        }));
        
        // Log the action
        const timeString = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
        logEvent(timeString, 'Occupancy count manually reset to zero', 'exit');
    }
});

// Start WebSocket connection when DOM is loaded
document.addEventListener('DOMContentLoaded', connectWebSocket);

// Add responsive behavior for mobile devices
function handleResize() {
    if (window.innerWidth < 768) {
        chart.options.scales.x.ticks.maxTicksLimit = 6;
    } else {
        chart.options.scales.x.ticks.maxTicksLimit = 10;
    }
    chart.update();
}

window.addEventListener('resize', handleResize);
handleResize(); // Initial call

// Function to add entries to the event log
function logEvent(time, message, eventType) {
    // Clear the default "waiting for events" message if needed
    clearFirstLogItemIfDefault();
    
    // Create the log entry
    const logItem = document.createElement('div');
    logItem.className = `list-group-item d-flex justify-content-between align-items-center ${eventType ? 'event-' + eventType : ''}`;
    
    // Create the content
    const eventText = document.createElement('span');
    eventText.innerHTML = message;
    
    // Create the timestamp
    const timestamp = document.createElement('small');
    timestamp.className = 'text-muted ms-2';
    timestamp.textContent = time;
    
    // Add them to the log item
    logItem.appendChild(eventText);
    logItem.appendChild(timestamp);
    
    // Add to the event log at the top
    eventLog.prepend(logItem);
    
    // Limit the number of log items (optional)
    if (eventLog.children.length > 100) {
        eventLog.removeChild(eventLog.lastChild);
    }
}