const BACKEND_HOST = 'localhost';
const BACKEND_PORT = 44556;

let backendSocket = null;
let messageQueue = [];
let messageId = 0;

export const connectToBackend = () => {
    if (backendSocket && backendSocket.readyState === WebSocket.OPEN) {
        return Promise.resolve(backendSocket);
    }

    return new Promise((resolve, reject) => {
        try {
            backendSocket = new WebSocket(`ws://${BACKEND_HOST}:${BACKEND_PORT}`);

            backendSocket.onopen = () => {
                console.log('✅ Connected to backend C# service');
                // Send queued messages
                messageQueue.forEach(msg => backendSocket.send(JSON.stringify(msg)));
                messageQueue = [];
                resolve(backendSocket);
            };

            backendSocket.onerror = (error) => {
                console.error('❌ Backend connection error:', error);
                reject(error);
            };

            backendSocket.onclose = () => {
                console.log('🔌 Backend connection closed');
                backendSocket = null;
            };

            backendSocket.onmessage = (event) => {
                try {
                    const response = JSON.parse(event.data);
                    console.log('📥 Backend response:', response);

                    // Find and resolve pending promise
                    const pending = pendingRequests.get(response.requestId);
                    if (pending) {
                        if (response.success) {
                            pending.resolve(response.data);
                        } else {
                            pending.reject(new Error(response.error || 'Request failed'));
                        }
                        pendingRequests.delete(response.requestId);
                    }
                } catch (error) {
                    console.error('❌ Failed to parse backend response:', error);
                }
            };
        } catch (error) {
            reject(error);
        }
    });
};

const pendingRequests = new Map();

export const sendBackendRequest = async (action, data = {}) => {
    if (!backendSocket || backendSocket.readyState !== WebSocket.OPEN) {
        try {
            await connectToBackend();
        } catch (error) {
            console.error('❌ Failed to connect to backend:', error);
            throw error;
        }
    }

    const requestId = `msg_${Date.now()}_${messageId++}`;
    const request = {
        requestId,
        action,
        ...data
    };

    return new Promise((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject });

        try {
            backendSocket.send(JSON.stringify(request));
        } catch (error) {
            pendingRequests.delete(requestId);
            reject(error);
        }
    });
};

export const getDesktopIcons = async () => {
    try {
        console.log('📡 Fetching desktop icons from backend...');
        const icons = await sendBackendRequest('getDesktopIcons');
        console.log(`✅ Received ${icons?.length || 0} icons from backend`);
        return icons || [];
    } catch (error) {
        console.error('❌ Failed to get desktop icons:', error);
        return [];
    }
};

export const clearIconCache = async () => {
    try {
        const result = await sendBackendRequest('clearIconCache');
        return result;
    } catch (error) {
        console.error('❌ Failed to clear icon cache:', error);
        throw error;
    }
};

export const getIconCacheInfo = async () => {
    try {
        const info = await sendBackendRequest('getIconCacheInfo');
        return info;
    } catch (error) {
        console.error('❌ Failed to get icon cache info:', error);
        throw error;
    }
};

export const registerDockApps = async (paths) => {
    try {
        const result = await sendBackendRequest('registerDockApps', { paths });
        return result;
    } catch (error) {
        console.error('❌ Failed to register dock apps:', error);
        throw error;
    }
};

export const getIndicatorState = async (iconId) => {
    try {
        const result = await sendBackendRequest('getIndicatorState', { iconId });
        return result;
    } catch (error) {
        console.error('❌ Failed to get indicator state:', error);
        throw error;
    }
};

export const updateSortOrder = async (itemId, sortOrder) => {
    return await sendBackendRequest('update_sort_order', { itemId, sortOrder });
};

export const batchUpdateSort = async (items) => {
    return await sendBackendRequest('batch_update_sort', { items });
};

export const togglePin = async (itemId, isPinned) => {
    return await sendBackendRequest('toggle_pin', { itemId, isPinned });
};
