import os

file_path = r'e:\software\DesktopManager\frontend\electron\main.js'

new_function_code = r"""const connectToBackend = async () => {
    if (backendSocket && backendSocket.readyState === 1) {
        return Promise.resolve(backendSocket);
    }

    const maxRetries = 20; // 10 seconds total (20 * 500ms)
    const retryInterval = 500;

    for (let i = 0; i < maxRetries; i++) {
        try {
            return await new Promise((resolve, reject) => {
                const net = require('net');
                const socket = new net.Socket();

                let connected = false;

                socket.connect(BACKEND_PORT, BACKEND_HOST, () => {
                    console.log('🔌 Connected to backend C# service');
                    connected = true;
                    backendSocket = socket;
                    setupSocketHandlers(socket);
                    resolve(socket);
                });

                socket.on('error', (error) => {
                    if (!connected) {
                        reject(error);
                    }
                });
            });
        } catch (error) {
            console.log(`⏳ Backend not ready, retrying (${i + 1}/${maxRetries})...`);
            if (i === maxRetries - 1) throw error;
            await new Promise(r => setTimeout(r, retryInterval));
        }
    }
};

const setupSocketHandlers = (socket) => {
    socket.on('error', (error) => {
        console.error('🔌 Backend connection error:', error);
    });

    socket.on('close', () => {
        console.log('🔌 Backend connection closed');
        backendSocket = null;
    });

    let buffer = '';
    socket.on('data', (data) => {
        try {
            buffer += data.toString('utf8');

            // Split buffer by newlines to handle multiple messages
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line in buffer

            for (const line of lines) {
                const message = line.trim();
                if (!message) continue;

                const response = JSON.parse(message);
                console.log('📥 Backend response:', response);

                const pending = pendingRequests.get(response.requestId);
                if (pending) {
                    if (response.success) {
                        const resolvedData = response.data !== undefined ? response.data : response;
                        pending.resolve(resolvedData);
                    } else {
                        pending.reject(new Error(response.error || 'Request failed'));
                    }
                    pendingRequests.delete(response.requestId);
                }
            }
        } catch (error) {
            console.error('🔌 Failed to parse backend response:', error);
        }
    });
};
"""

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

start_index = -1
end_index = -1

for i, line in enumerate(lines):
    if 'const connectToBackend = () => {' in line:
        start_index = i
    if 'const sendBackendRequest =' in line:
        end_index = i
        break

if start_index != -1 and end_index != -1:
    print(f"Replacing lines {start_index} to {end_index}")
    new_lines = lines[:start_index]
    new_lines.append(new_function_code + '\n')
    new_lines.extend(lines[end_index:])
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print("Updates applied successfully.")
else:
    print("Could not find start or end markers.")
