document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const preview = document.getElementById('preview');
  const status = document.getElementById('status');

  function showStatus(message, type) {
    status.textContent = message;
    status.className = `status-${type}`;
    status.style.display = 'block';
  }

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.src = e.target.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);

    try {
      showStatus('Uploading file...', 'loading');

      // Create form data
      const formData = new FormData();
      formData.append('file', file);

      // Upload file to server
      const uploadResponse = await fetch('/upload', {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`);
      }

      const uploadData = await uploadResponse.json();
      
      if (!uploadData.success) {
        throw new Error('Upload failed');
      }

      // Get API key from extension
      chrome.runtime.sendMessage({ type: 'GET_API_KEY' }, async (response) => {
        if (!response.apiKey) {
          showStatus('Error: API key not found', 'error');
          return;
        }

        try {
          showStatus('Analyzing document...', 'loading');
          
          // Convert image to base64
          const base64Image = preview.src.split(',')[1];
          
          // Call Gemini API
          const apiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${response.apiKey}`
            },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: "Analyze this document and extract all text fields in JSON format. Include field names and their values."
                }, {
                  inline_data: {
                    mime_type: file.type,
                    data: base64Image
                  }
                }]
              }]
            })
          });

          const data = await apiResponse.json();
          
          if (data.candidates && data.candidates[0].content) {
            const results = JSON.parse(data.candidates[0].content.parts[0].text);
            
            // Send results back to extension
            chrome.runtime.sendMessage({
              type: 'SCAN_RESULTS',
              results: results
            });
            
            showStatus('Analysis complete! You can close this window.', 'success');
          } else {
            throw new Error('Invalid response from API');
          }
        } catch (error) {
          console.error('Error:', error);
          showStatus(`Error: ${error.message}`, 'error');
        }
      });
    } catch (error) {
      console.error('Error:', error);
      showStatus(`Error: ${error.message}`, 'error');
    }
  });
}); 