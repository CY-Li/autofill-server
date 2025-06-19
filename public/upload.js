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
    showStatus('無效的上傳連結', 'error');
    return;
  }

  if (!apiKey) {
    showStatus('請重新輸入API Key後，再次產生上傳連結', 'error');
    return;
  }

  function showStatus(message, type) {
    let icon = '';
    if (type === 'success') icon = '<span class="status-icon">✅</span>';
    else if (type === 'error') icon = '<span class="status-icon">❌</span>';
    else if (type === 'loading') icon = '<span class="status-icon">⏳</span>';
    else if (type === 'info') icon = '<span class="status-icon">ℹ️</span>';
    status.innerHTML = icon + '<span>' + message + '</span>';
    status.className = `status status-${type}`;
    status.style.display = 'flex';
    // 觸發動畫
    status.style.opacity = '0';
    setTimeout(() => { status.style.opacity = '1'; }, 10);
  }

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showStatus('請選擇圖片檔案', 'error');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showStatus('檔案大小必須小於5MB', 'error');
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
        // Auto-close window after 3 seconds
        setTimeout(() => {
          window.close();
        }, 3000);
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