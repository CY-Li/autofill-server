document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const preview = document.getElementById('preview');
  const status = document.getElementById('status');
  const dragArea = document.querySelector('.drag-area');

  // Get token and API key from URL
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  const apiKey = urlParams.get('apiKey');
  
  if (!token) {
    showStatus('Error: Invalid upload link', 'error');
    return;
  }

  if (!apiKey) {
    showStatus('Error: API key not found in URL', 'error');
    return;
  }

  function showStatus(message, type) {
    status.textContent = message;
    status.className = `status-${type}`;
    status.style.display = 'block';
  }

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showStatus('Please select an image file', 'error');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showStatus('File size must be less than 5MB', 'error');
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.src = e.target.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);

    try {
      showStatus('Uploading and analyzing document...', 'loading');

      // Log API key for debugging (remove in production)
      console.log('API Key from URL:', apiKey.substring(0, 10) + '...');

      // Create form data
      const formData = new FormData();
      formData.append('file', file);

      // Upload file to server with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const uploadResponse = await fetch(`/upload?token=${token}`, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey
        },
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json();
        throw new Error(errorData.message || `Upload failed: ${uploadResponse.statusText}`);
      }

      const uploadData = await uploadResponse.json();
      
      if (!uploadData.success) {
        throw new Error('Upload failed');
      }

      showStatus('Upload successful! Results will appear in the extension.', 'success');
      
      // Show a message to close the window
      setTimeout(() => {
        showStatus('You can close this window now. Check the extension for results.', 'info');
      }, 2000);
      
    } catch (error) {
      console.error('Error:', error);
      if (error.name === 'AbortError') {
        showStatus('Error: Upload timed out. Please try again.', 'error');
      } else {
        showStatus(`Error: ${error.message}`, 'error');
      }
    }
  }

  // File input change event
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    handleFile(file);
  });

  // Drag and drop events
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dragArea.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  ['dragenter', 'dragover'].forEach(eventName => {
    dragArea.addEventListener(eventName, () => {
      dragArea.classList.add('active');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dragArea.addEventListener(eventName, () => {
      dragArea.classList.remove('active');
    });
  });

  dragArea.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    handleFile(file);
  });
}); 