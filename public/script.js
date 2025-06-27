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
                radius: 0 // Hide points on the line dataset
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
            
            // Update distance displays
            if (data.entryDistance !== undefined) {
                entryDistanceElement.textContent = data.entryDistance > 0 ? `${data.entryDistance} cm` : '-- cm';
            }
            if (data.exitDistance !== undefined) {
                exitDistanceElement.textContent = data.exitDistance > 0 ? `${data.exitDistance} cm` : '-- cm';
            }
            
            // Format timestamp for display
            const timestamp = new Date(data.timestamp);
            const timeString = timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
            
            // Process event data
            if (data.event === 'entry') {
                entryCount++;
                // If the ESP8266 sends occupancy data, use it directly
                const prevCount = currentCount;
                currentCount = data.occupancy !== undefined ? data.occupancy : currentCount + 1;
                updateChart(timeString, 'entry');
                logEvent(timeString, `Entry detected (${data.entryDistance}cm → ${data.exitDistance}cm)`, 'entry');
                
                // Add animation effect to the counter
                animateValue(entryCountElement, entryCount - 1, entryCount, 300);
                animateValue(currentCountElement, prevCount, currentCount, 300);
            } else if (data.event === 'exit') {
                exitCount++;
                const prevCount = currentCount;
                // If the ESP8266 sends occupancy data, use it directly
                currentCount = data.occupancy !== undefined ? data.occupancy : Math.max(0, currentCount - 1);
                updateChart(timeString, 'exit');
                logEvent(timeString, `Exit detected (${data.exitDistance}cm → ${data.entryDistance}cm)`, 'exit');
                
                // Add animation effect to the counter
                animateValue(exitCountElement, exitCount - 1, exitCount, 300);
                animateValue(currentCountElement, prevCount, currentCount, 300);
            }
        } catch (err) {
            console.error('Error processing message:', err);
        }
    };
}

// Update chart with new data
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
    
    // Update the chart with animation
    chart.update();
}

// Log an event to the event log
function logEvent(time, message, type) {
    clearFirstLogItemIfDefault();
    
    const logItem = document.createElement('div');
    logItem.className = 'list-group-item d-flex justify-content-between align-items-center';
    
    const eventText = document.createElement('span');
    eventText.className = `event-${type}`;
    eventText.innerHTML = `<strong>${message}</strong>`;
    
    const timeText = document.createElement('small');
    timeText.className = 'text-secondary';
    timeText.textContent = time;
    
    logItem.appendChild(eventText);
    logItem.appendChild(timeText);
    
    // Add to the top of the log with fade-in effect
    logItem.style.opacity = '0';
    eventLog.prepend(logItem);
    
    // Animate the new log item
    setTimeout(() => {
        logItem.style.transition = 'opacity 0.3s ease-in';
        logItem.style.opacity = '1';
    }, 10);
    
    // Limit log size
    if (eventLog.children.length > 100) {
        eventLog.removeChild(eventLog.lastChild);
    }
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
    
    // Save current value for restoration if needed
    const current = parseInt(element.textContent);
    
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