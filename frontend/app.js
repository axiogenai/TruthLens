function showToast(message, type = 'error') {
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    const toast = document.createElement('div');
    toast.className = `toast-msg toast-${type}`;
    const iconHtml = type === 'error' 
        ? `<div class="toast-icon-wrapper error-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>`
        : `<div class="toast-icon-wrapper success-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>`;
    toast.innerHTML = `${iconHtml} <span class="toast-text">${message}</span>`;
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
