<!DOCTYPE html>
<html>
<head>
    <title>Same-Origin Auth Test</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; }
        .test-section { background: white; margin: 20px 0; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        button { background: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin: 5px; }
        button:hover { background: #0056b3; }
        pre { background: #f8f9fa; padding: 15px; border-radius: 4px; overflow-x: auto; border-left: 4px solid #007bff; }
        .success { border-left-color: #28a745; }
        .error { border-left-color: #dc3545; }
        .info { border-left-color: #17a2b8; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔐 Same-Origin Authentication Test</h1>
        <p>This test runs on the same domain as your app to avoid CORS issues.</p>
        
        <div class="test-section info">
            <h3>📋 Instructions</h3>
            <ol>
                <li>Click "Run Authentication Test" below</li>
                <li>Watch the results in the console output</li>
                <li>Check if cookies are being set and read properly</li>
            </ol>
            <button onclick="runTest()">🚀 Run Authentication Test</button>
        </div>
        
        <div class="test-section">
            <h3>📊 Test Results</h3>
            <pre id="results">Click the button above to run the authentication test...</pre>
        </div>
        
        <div class="test-section">
            <h3>🍪 Current Cookies</h3>
            <pre id="cookies">Loading...</pre>
            <button onclick="updateCookies()">🔄 Refresh Cookies</button>
        </div>
    </div>

    <script src="/test-auth.js"></script>
    <script>
        const results = document.getElementById('results');
        const cookies = document.getElementById('cookies');
        
        function updateCookies() {
            cookies.textContent = document.cookie || 'No cookies found';
        }
        
        function log(message, type = 'info') {
            const timestamp = new Date().toLocaleTimeString();
            const logEntry = `[${timestamp}] ${message}`;
            results.textContent += logEntry + '\n';
            results.scrollTop = results.scrollHeight;
            results.className = type;
        }
        
        // Override the console.log in test-auth.js to display in our UI
        const originalConsoleLog = console.log;
        console.log = function(...args) {
            originalConsoleLog.apply(console, args);
            const message = args.join(' ');
            log(message, message.includes('✅') ? 'success' : message.includes('❌') ? 'error' : 'info');
        };
        
        // Initialize
        updateCookies();
        log('🚀 Same-origin auth test ready. Click "Run Authentication Test" to begin.');
    </script>
</body>
</html>
