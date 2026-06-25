/**
 * Sanitize user input to prevent XSS attacks.
 * Use this whenever inserting user-provided content into the DOM.
 */
function sanitizeHTML(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function showToast(message, type = 'error') {
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    const toast = document.createElement('div');
    toast.className = `toast-msg toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove after delay
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('analyze-form');
    const textarea = document.getElementById('article-text');
    const submitBtn = document.getElementById('submit-btn');
    const btnText = document.querySelector('.btn-text');
    const spinner = document.getElementById('spinner');

    const fileInput = document.getElementById('file-input');
    const filePreview = document.getElementById('file-preview');
    const previewName = document.getElementById('preview-name');
    const removeFileBtn = document.getElementById('remove-file-btn');
    const uploadZone = document.getElementById('upload-zone');
    let selectedFile = null;



    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
    });
    uploadZone.addEventListener('click', (e) => {
        if (e.target !== fileInput) {
            fileInput.click();
        }
    });
    fileInput.addEventListener('click', (e) => e.stopPropagation());
    fileInput.addEventListener('change', (e) => { if (e.target.files.length > 0) handleFileSelect(e.target.files[0]); });
    removeFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedFile = null;
        fileInput.value = '';
        filePreview.classList.add('hidden');
        uploadZone.classList.remove('hidden');
    });

    function handleFileSelect(file) {
        selectedFile = file;
        previewName.textContent = file.name;
        uploadZone.classList.add('hidden');
        filePreview.classList.remove('hidden');
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = textarea.value.trim();
        if (!text && !selectedFile) { showToast("Please enter text or upload a file.", "error"); return; }

        submitBtn.disabled = true;
        btnText.textContent = 'Analyzing...';
        spinner.classList.remove('hidden');

        const formData = new FormData();
        if (text) formData.append('text', text);
        if (selectedFile) formData.append('file', selectedFile);
        
        // Append model_mode (default to pro)
        formData.append('model_mode', 'flash');

        try {
            const response = await fetch('/api/predict', {
                method: 'POST',
                body: formData
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.detail || 'Network error');
            }
            const data = await response.json();
            sessionStorage.setItem('analysisResult', JSON.stringify(data));
            window.location.href = 'results.html';
        } catch (error) {
            console.error(error);
            showToast('Error: ' + error.message, 'error');
            submitBtn.disabled = false;
            btnText.textContent = 'Start Analysis';
            spinner.classList.add('hidden');
        }
    });
});
