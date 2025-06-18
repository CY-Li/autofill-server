const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

// Enable CORS with specific origin
app.use(cors({
  origin: ['chrome-extension://*', 'https://autofill-server.zeabur.app'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

// Serve static files
app.use(express.static('public'));

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Token validation middleware
const validateToken = (req, res, next) => {
  const token = req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'Token is required' });
  }

  // Here you would typically validate the token against a database
  // For now, we'll just check if it exists and hasn't expired
  const tokenPath = path.join(__dirname, 'tokens', `${token}.json`);
  if (!fs.existsSync(tokenPath)) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const tokenData = JSON.parse(fs.readFileSync(tokenPath));
  if (Date.now() > tokenData.expiresAt) {
    fs.unlinkSync(tokenPath);
    return res.status(401).json({ error: 'Token has expired' });
  }

  req.token = token;
  next();
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.get('/upload', validateToken, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.post('/upload', validateToken, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // Get API key from extension
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ error: 'API key is required' });
    }

    // Convert image to base64
    const base64Image = fs.readFileSync(req.file.path).toString('base64');

    // Call Gemini API
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: "Analyze this document and extract all text fields in JSON format. Include field names and their values."
          }, {
            inline_data: {
              mime_type: req.file.mimetype,
              data: base64Image
            }
          }]
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.candidates && data.candidates[0].content) {
      const results = JSON.parse(data.candidates[0].content.parts[0].text);
      
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      
      // Remove used token
      const tokenPath = path.join(__dirname, 'tokens', `${req.token}.json`);
      if (fs.existsSync(tokenPath)) {
        fs.unlinkSync(tokenPath);
      }

      res.json({ 
        success: true, 
        results: results 
      });
    } else {
      throw new Error('Invalid response from API');
    }
  } catch (error) {
    console.error('Error:', error);
    
    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: 'Something went wrong!',
      message: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  
  // Clean up uploaded file if it exists
  if (req.file && fs.existsSync(req.file.path)) {
    fs.unlinkSync(req.file.path);
  }
  
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: err.message 
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 