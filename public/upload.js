document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const preview = document.getElementById('preview');
  const status = document.getElementById('status');
  const dragArea = document.querySelector('.drag-area');

  // Get token from URL
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  if (!token) {
    showStatus('Error: Invalid upload link', 'error');
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
      // Check if extension is installed
      if (!chrome.runtime) {
        showStatus('Error: Extension is not installed', 'error');
        return;
      }

      // Get API key from extension
      const apiKeyResponse = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'GET_API_KEY' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });

      if (!apiKeyResponse || !apiKeyResponse.apiKey) {
        showStatus('Error: API key not found', 'error');
        return;
      }

      showStatus('Uploading and analyzing document...', 'loading');

      // Create form data
      const formData = new FormData();
      formData.append('file', file);

      // Upload file to server with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const uploadResponse = await fetch(`/upload?token=${token}`, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKeyResponse.apiKey
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

      // Send results back to extension
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'SCAN_RESULTS',
          results: uploadData.results
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      showStatus('Analysis complete! You can close this window.', 'success');
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