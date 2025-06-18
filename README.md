# Autofill Server

This is the backend server for the Chrome extension that handles document scanning and autofill functionality.

## Features

- File upload handling with Multer
- Google Gemini API integration for document analysis
- WebSocket and Server-Sent Events (SSE) for real-time communication
- Token-based security system
- CORS configuration for Chrome extension
- Health check endpoint

## Deployment on Zeabur

1. **Environment Variables**: Make sure to set the following environment variables in Zeabur:
   - `PORT`: 8080 (Zeabur default)
   - Any other required environment variables

2. **Build Process**: Zeabur will automatically:
   - Install dependencies from `package.json`
   - Build the Docker image
   - Deploy the container

3. **Port Configuration**: The server is configured to run on port 8080, which is the standard port for Zeabur.

## Testing

### Health Check
Visit `/health` to check if the server is running properly.

### Test Page
Visit `/test` to access a comprehensive test page that includes:
- Health check testing
- WebSocket connection testing
- SSE connection testing
- Token registration testing

### Manual Testing
1. Open the test page at `https://your-zeabur-domain.zeabur.app/test`
2. Click each test button to verify functionality
3. Check the console logs for detailed information

## API Endpoints

- `GET /` - Main upload page
- `GET /test` - Test page
- `GET /health` - Health check
- `GET /upload?token=<token>` - Upload page with token validation
- `POST /register-token` - Register a new token
- `POST /upload?token=<token>` - Upload file with token validation
- `GET /sse/:token` - SSE endpoint for real-time updates
- WebSocket endpoint: `ws://your-domain?token=<token>`

## Troubleshooting

### WebSocket Issues
If WebSocket connections fail, the server automatically falls back to SSE (Server-Sent Events).

### Port Issues
Make sure the server is configured to use port 8080 for Zeabur deployment.

### CORS Issues
The server is configured to allow requests from Chrome extensions and the Zeabur domain.

### File Upload Issues
- Check file size limits (5MB)
- Ensure only image files are uploaded
- Verify token is valid and not expired

## Logs

Check the Zeabur logs for detailed information about:
- Server startup
- WebSocket/SSE connections
- File uploads
- API calls to Gemini
- Error messages

## Security

- Tokens are stored in memory and expire after a set time
- File uploads are validated for type and size
- CORS is configured to only allow specific origins
- API keys are required for Gemini API calls 