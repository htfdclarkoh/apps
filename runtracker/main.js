import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, getDoc, writeBatch, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Config ---
const firebaseConfig = {
    apiKey: "AIzaSyCqqW_fryqigzg7zDWgEsuADhBkPYcHQMo",
    authDomain: "db2-2f64c.firebaseapp.com",
    projectId: "db2-2f64c",
    storageBucket: "db2-2f64c.firebasestorage.app",
    messagingSenderId: "234811583682",
    appId: "1:234811583682:web:aa2bd4e29296207c0d5f5b",
    measurementId: "G-38MS80C490"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- State ---
let allCalls = [];
let nextIncidentData = { id: '...', seq: 1, year: new Date().getFullYear() };
let currentUser = null;
let currentStatsYear = new Date().getFullYear();
let systemConfig = { holidays: [] }; 

// Sorting State
let currentSort = { field: 'incidentNumber', dir: 'desc' };

// --- Auth & Init ---
async function initApp() {
    try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
        } else {
            await signInAnonymously(auth);
        }
    } catch (error) {
        console.error("Auth error:", error);
        document.getElementById('connectionStatus').innerHTML = '<span class="text-red-500 uppercase">Auth Error</span>';
    }
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('connectionStatus').innerHTML = '<span class="text-green-500 font-bold uppercase">Online</span>';
        setupRealtimeListener();
        loadConfiguration(); 
        selectType('EMS');
        setNowDefaults();
        toggleMutualAid(); 
    }
});

initApp();

// --- FORCE UPPERCASE HELPER ---
window.forceCaps = function(el) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    el.value = el.value.toUpperCase();
    el.setSelectionRange(start, end);
}

// --- MODAL & EDIT LOGIC ---
window.openEditModal = function(id) {
    const call = allCalls.find(c => c.id === id);
    if (!call) return;

    document.getElementById('edit_docId').value = id;
    document.getElementById('edit_incidentNumber').value = call.incidentNumber; 
    document.getElementById('edit_dispatchDate').value = call.dispatchDate;
    document.getElementById('edit_dispatchTime').value = call.dispatchTime;
    document.getElementById('edit_callNature').value = call.callNature;
    document.getElementById('edit_address').value = call.address;
    document.getElementById('edit_units').value = call.units || '';
    document.getElementById('edit_notes').value = call.notes || '';
    document.getElementById('edit_emsDisposition').value = call.emsDisposition || '';
    
    selectEditType(call.responseType || 'EMS');

    const maCheckbox = document.getElementById('edit_mutualAid');
    maCheckbox.checked = call.mutualAid || false;
    toggleEditMutualAid();
    
    if (call.mutualAid) {
        document.getElementById('edit_mutualAidType').value = call.mutualAidType;
        handleEditMutualAidTypeChange();
        document.getElementById('edit_mutualAidDept').value = call.mutualAidDept || '';
    }

    document.getElementById('editModal').classList.remove('hidden');
}

window.closeEditModal = function() {
    document.getElementById('editModal').classList.add('hidden');
}

window.saveEdit = async function() {
    const id = document.getElementById('edit_docId').value;
    if(!id) return;

    const timeInput = document.getElementById('edit_dispatchTime');
    validateTime(timeInput);
    if (timeInput.classList.contains('border-red-500')) {
        showToast("INVALID TIME IN EDIT FORM", true);
        return;
    }

    try {
        const isMutualAid = document.getElementById('edit_mutualAid').checked;
        const responseType = document.getElementById('edit_responseType').value;
        const emsDisp = (responseType === 'EMS' || responseType === 'Both') 
            ? document.getElementById('edit_emsDisposition').value 
            : null;
        
        const newId = document.getElementById('edit_incidentNumber').value.toUpperCase();
        let newYear = 0;
        let newSeq = 0;
        
        const idMatch = newId.match(/^(\d{2})HT(\d+)$/);
        if (idMatch) {
            newYear = 2000 + parseInt(idMatch[1]);
            newSeq = parseInt(idMatch[2]);
        } else {
            const oldCall = allCalls.find(c => c.id === id);
            if (oldCall) {
                newYear = oldCall.year;
                newSeq = oldCall.sequence;
            } else {
                newYear = new Date().getFullYear(); 
            }
        }

        const callData = {
            incidentNumber: newId,
            year: newYear,
            sequence: newSeq,
            dispatchDate: document.getElementById('edit_dispatchDate').value,
            dispatchTime: document.getElementById('edit_dispatchTime').value,
            callNature: document.getElementById('edit_callNature').value.toUpperCase(),
            responseType: responseType,
            emsDisposition: emsDisp,
            address: document.getElementById('edit_address').value.toUpperCase(),
            units: document.getElementById('edit_units').value.toUpperCase(),
            mutualAid: isMutualAid,
            mutualAidType: isMutualAid ? document.getElementById('edit_mutualAidType').value : null,
            mutualAidDept: isMutualAid ? document.getElementById('edit_mutualAidDept').value.toUpperCase() : null,
            notes: document.getElementById('edit_notes').value.toUpperCase(),
            lastModified: new Date().toISOString(),
            lastModifiedBy: currentUser.uid
        };

        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'calls', id);
        await updateDoc(docRef, callData);
        
        closeEditModal();
        showToast(`CALL UPDATED SUCCESSFULLY!`);

    } catch (e) {
        console.error("Update Error:", e);
        showToast("FAILED TO UPDATE CALL", true);
    }
}

window.selectEditType = function(type) {
    document.getElementById('edit_responseType').value = type;
    const btnEms = document.getElementById('edit_btn-ems');
    const btnFire = document.getElementById('edit_btn-fire');
    const btnBoth = document.getElementById('edit_btn-both');
    const dispSection = document.getElementById('edit_emsDispositionSection');
    const baseClass = "flex items-center justify-center py-2.5 rounded-lg font-bold border border-gray-600 bg-gray-800 text-gray-400 hover:bg-gray-700 transition uppercase text-xs";
    
    btnEms.className = baseClass;
    btnFire.className = baseClass;
    btnBoth.className = baseClass;
    
    if(type === 'EMS') {
        btnEms.className = "flex items-center justify-center py-2.5 rounded-lg font-bold border border-blue-500 bg-blue-600 text-white shadow-lg shadow-blue-900/50 transform scale-[1.02] transition uppercase text-xs";
        dispSection.classList.remove('hidden');
    } else if (type === 'Fire') {
        btnFire.className = "flex items-center justify-center py-2.5 rounded-lg font-bold border border-red-500 bg-red-600 text-white shadow-lg shadow-red-900/50 transform scale-[1.02] transition uppercase text-xs";
        dispSection.classList.add('hidden');
    } else if (type === 'Both') {
        btnBoth.className = "flex items-center justify-center py-2.5 rounded-lg font-bold border border-purple-500 bg-purple-600 text-white shadow-lg shadow-purple-900/50 transform scale-[1.02] transition uppercase text-xs";
        dispSection.classList.remove('hidden');
    }
}

window.toggleEditMutualAid = function() {
    const chk = document.getElementById('edit_mutualAid');
    const fields = document.getElementById('edit_mutualAidFields');
    if (chk.checked) {
        fields.classList.remove('hidden');
        handleEditMutualAidTypeChange(); 
    } else {
        fields.classList.add('hidden');
    }
}

window.handleEditMutualAidTypeChange = function() {
    const type = document.getElementById('edit_mutualAidType').value;
    const chips = document.getElementById('edit_deptChips');
    const input = document.getElementById('edit_mutualAidDept');
    if (type === 'Received') {
        chips.classList.remove('hidden');
        input.placeholder = "SELECT/TYPE MULTIPLE";
    } else {
        chips.classList.add('hidden');
        input.placeholder = "DEPARTMENT NAME";
    }
}

window.addUnitToEditInput = function(unitName) {
    const input = document.getElementById('edit_units');
    const currentVal = input.value.trim();
    if (currentVal.length === 0) input.value = unitName;
    else if (!currentVal.includes(unitName)) input.value = currentVal + ", " + unitName;
}

window.addDeptToEditInput = function(deptName) {
    const input = document.getElementById('edit_mutualAidDept');
    const currentVal = input.value.trim();
    if (currentVal.length === 0) input.value = deptName;
    else if (!currentVal.includes(deptName)) input.value = currentVal + ", " + deptName;
}

// --- LOAD CONFIG ---
async function loadConfiguration() {
    try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'callTrackerConfig', 'options');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            const data = snap.data();
            systemConfig.holidays = data.holidays || [];

            const natureList = document.getElementById('natures');
            natureList.innerHTML = '';
            if (data.natures && Array.isArray(data.natures)) {
                data.natures.forEach(n => {
                    const opt = document.createElement('option');
                    opt.value = n.toUpperCase();
                    natureList.appendChild(opt);
                });
            }
            const maList = document.getElementById('maDepts');
            maList.innerHTML = '';
            if (data.depts && Array.isArray(data.depts)) {
                data.depts.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.toUpperCase();
                    maList.appendChild(opt);
                });
            }
            const populateChips = (containerId, items, clickHandler) => {
                const container = document.getElementById(containerId);
                if(!container) return;
                container.innerHTML = '';
                items.forEach(u => {
                    const chip = document.createElement('span');
                    chip.className = "unit-chip bg-gray-800 border border-gray-600 px-3 py-1 rounded-full text-xs font-medium text-gray-300 hover:bg-gray-700 hover:border-blue-500 hover:text-white uppercase";
                    chip.textContent = u.toUpperCase();
                    chip.onclick = () => clickHandler(u.toUpperCase());
                    container.appendChild(chip);
                });
            };
            if (data.units && Array.isArray(data.units)) {
                populateChips('unitChips', data.units, addUnitToInput);
                populateChips('edit_unitChips', data.units, addUnitToEditInput);
            }
            if (data.depts && Array.isArray(data.depts)) {
                populateChips('deptChips', data.depts, addDeptToInput);
                populateChips('edit_deptChips', data.depts, addDeptToEditInput);
            }
            updateStats();
        }
    } catch (e) {
        console.error("Failed to load config options", e);
    }
}

window.addUnitToInput = function(unitName) {
    const input = document.getElementById('units');
    const currentVal = input.value.trim();
    if (currentVal.length === 0) input.value = unitName;
    else if (!currentVal.includes(unitName)) input.value = currentVal + ", " + unitName;
}

window.addDeptToInput = function(deptName) {
    const input = document.getElementById('mutualAidDept');
    const currentVal = input.value.trim();
    if (currentVal.length === 0) input.value = deptName;
    else if (!currentVal.includes(deptName)) input.value = currentVal + ", " + deptName;
}

window.handleMutualAidTypeChange = function() {
    const type = document.getElementById('mutualAidType').value;
    const chips = document.getElementById('deptChips');
    const input = document.getElementById('mutualAidDept');
    if (type === 'Received') {
        chips.classList.remove('hidden');
        input.placeholder = "SELECT/TYPE MULTIPLE";
    } else {
        chips.classList.add('hidden');
        input.placeholder = "DEPARTMENT NAME";
    }
}

window.selectType = function(type) {
    document.getElementById('responseType').value = type;
    const btnEms = document.getElementById('btn-ems');
    const btnFire = document.getElementById('btn-fire');
    const btnBoth = document.getElementById('btn-both');
    const dispSection = document.getElementById('emsDispositionSection');
    const baseClass = "flex items-center justify-center py-2.5 rounded-lg font-bold border border-gray-600 bg-gray-800 text-gray-400 hover:bg-gray-700 transition uppercase";
    
    btnEms.className = baseClass;
    btnFire.className = baseClass;
    btnBoth.className = baseClass;
    
    if(type === 'EMS') {
        btnEms.className = "flex items-center justify-center py-2.5 rounded-lg font-bold border border-blue-500 bg-blue-600 text-white shadow-lg shadow-blue-900/50 transform scale-[1.02] transition uppercase";
        dispSection.classList.remove('hidden');
    } else if (type === 'Fire') {
        btnFire.className = "flex items-center justify-center py-2.5 rounded-lg font-bold border border-red-500 bg-red-600 text-white shadow-lg shadow-red-900/50 transform scale-[1.02] transition uppercase";
        dispSection.classList.add('hidden');
    } else if (type === 'Both') {
        btnBoth.className = "flex items-center justify-center py-2.5 rounded-lg font-bold border border-purple-500 bg-purple-600 text-white shadow-lg shadow-purple-900/50 transform scale-[1.02] transition uppercase";
        dispSection.classList.remove('hidden');
    }
}

window.autoFormatTime = function(el) {
    let v = el.value.replace(/\D/g, ''); 
    if (v.length >= 3) v = v.slice(0, 2) + ':' + v.slice(2);
    if (v.length > 5) v = v.slice(0, 5);
    el.value = v;
}

window.validateTime = function(el) {
    const regex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (el.value && !regex.test(el.value)) {
        showToast("INVALID TIME FORMAT. USE 24H HH:MM", true);
        el.classList.add('border-red-500', 'ring-2', 'ring-red-500');
        el.classList.remove('border-gray-600');
    } else {
        el.classList.remove('border-red-500', 'ring-2', 'ring-red-500');
        el.classList.add('border-gray-600');
        if(el.value.length === 4 && el.value.indexOf(':') === 1) el.value = '0' + el.value;
    }
}

window.exportToCSV = function() {
    if (!allCalls || allCalls.length === 0) {
        showToast("NO DATA TO EXPORT", true);
        return;
    }
    const headers = ['Incident #', 'Date/Time', 'Nature', 'Address', 'Type', 'Units', 'Mutual Aid', 'Disposition', 'Notes'];
    const rows = allCalls.map(c => {
        let reported = '';
        if (c.dispatchDate && c.dispatchTime) {
            try {
                const [y, m, d] = c.dispatchDate.split('-');
                reported = `${m}/${d}/${y} ${c.dispatchTime}`;
            } catch(e) {}
        }
        let mutualAidStr = '';
        if (c.mutualAid) {
            const type = c.mutualAidType ? c.mutualAidType.toUpperCase() : 'UNKNOWN';
            const dept = c.mutualAidDept ? c.mutualAidDept : '';
            mutualAidStr = `${type} - ${dept}`;
        }
        const escapeCsv = (txt) => {
            if (!txt) return '';
            const str = String(txt);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };
        return [
            c.incidentNumber, reported, escapeCsv(c.callNature), escapeCsv(c.address),
            c.responseType === 'Fire' ? 'FIRE' : (c.responseType === 'EMS' ? 'EMS' : 'BOTH'),
            escapeCsv(c.units), escapeCsv(mutualAidStr), escapeCsv(c.emsDisposition), escapeCsv(c.notes)
        ].join(',');
    });
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `RMS_Export_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

window.handleFileUpload = function(input) {
    const file = input.files[0];
    if (!file) return;
    const statusEl = document.getElementById('importStatus');
    statusEl.textContent = "READING FILE...";
    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        try {
            statusEl.textContent = "PARSING CSV...";
            const rows = parseCSV(text);
            if (rows.length < 2) {
                alert("CSV SEEMS EMPTY OR INVALID FORMAT.");
                statusEl.textContent = "";
                return;
            }
            const existingIncidents = new Map();
            allCalls.forEach(call => { if (call.incidentNumber) existingIncidents.set(call.incidentNumber, call.id); });

            const ops = [];
            let parseErrors = 0;
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (row.length < 2) continue;
                try {
                    const incNum = row[0]?.trim().toUpperCase();
                    if (!incNum) continue;
                    const reported = row[1]?.trim(); 
                    const nature = row[2]?.trim().toUpperCase();
                    const address = row[3]?.trim().toUpperCase();
                    const typeRaw = row[4]?.trim().toUpperCase(); 
                    const units = row[5]?.trim().toUpperCase();
                    const mutualAidCombined = row[6]?.trim();
                    const disposition = row[7]?.trim().toUpperCase();
                    const notes = row[8]?.trim().toUpperCase();

                    let formattedDate = '';
                    let formattedTime = '';
                    if (reported && reported.includes(' ')) {
                        const [datePart, timePart] = reported.split(' ');
                        const [m, d, y] = datePart.split('/');
                        formattedDate = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
                        formattedTime = timePart;
                        if (timePart.length === 4 && timePart.indexOf(':') === 1) formattedTime = '0' + timePart;
                    }
                    const yearShort = incNum.substring(0, 2); 
                    const yearFull = 2000 + parseInt(yearShort);
                    const seqStr = incNum.replace(yearShort + 'HT', '').replace(yearShort + 'PL', '');
                    const seqNum = parseInt(seqStr);
                    let finalType = 'Both';
                    if (typeRaw === 'FIRE') finalType = 'Fire';
                    if (typeRaw === 'EMS') finalType = 'EMS';
                    let isMa = false;
                    let maType = null;
                    let maDept = null;
                    if (mutualAidCombined && mutualAidCombined.length > 2) {
                        isMa = true;
                        if (mutualAidCombined.toUpperCase().includes('GIVEN')) maType = 'Given';
                        else if (mutualAidCombined.toUpperCase().includes('RECEIVED')) maType = 'Received';
                        else maType = 'Given'; 
                        if (mutualAidCombined.includes(' - ')) maDept = mutualAidCombined.split(' - ')[1]?.trim().toUpperCase() || '';
                        else maDept = '';
                    }
                    const recordData = {
                        incidentNumber: incNum, sequence: seqNum, year: yearFull,
                        dispatchDate: formattedDate, dispatchTime: formattedTime,
                        callNature: nature, responseType: finalType, address: address,
                        units: units || '', mutualAid: isMa, mutualAidType: maType, mutualAidDept: maDept,
                        emsDisposition: disposition || '', notes: notes || '', imported: true
                    };
                    if (existingIncidents.has(incNum)) {
                        ops.push({ type: 'update', id: existingIncidents.get(incNum), data: { ...recordData, lastModified: new Date().toISOString(), lastModifiedBy: currentUser.uid } });
                    } else {
                        ops.push({ type: 'create', data: { ...recordData, createdAt: new Date().toISOString(), createdBy: currentUser.uid } });
                    }
                } catch (err) { parseErrors++; }
            }
            if (ops.length === 0) { alert("NO VALID ROWS FOUND TO IMPORT."); statusEl.textContent = ""; return; }
            const updates = ops.filter(o => o.type === 'update').length;
            const creates = ops.filter(o => o.type === 'create').length;
            if (confirm(`IMPORT SUMMARY:\n- NEW RECORDS: ${creates}\n- UPDATING RECORDS: ${updates}\n\nPROCEED?`)) {
                statusEl.textContent = `PROCESSING...`;
                await batchUpload(ops);
                statusEl.textContent = "DONE!";
                showToast(`SUCCESS: ${creates} CREATED, ${updates} UPDATED!`);
                input.value = ''; 
            } else { statusEl.textContent = "CANCELLED."; input.value = ''; }
        } catch (e) {
            console.error("Import error:", e);
            statusEl.textContent = "ERROR PARSING FILE.";
            alert("ERROR PARSING CSV. CHECK CONSOLE.");
        }
    };
    reader.readAsText(file);
};

function parseCSV(text) {
    const rows = [];
    let currentRow = [];
    let currentVal = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];
        if (inQuotes) {
            if (char === '"' && nextChar === '"') { currentVal += '"'; i++; }
            else if (char === '"') inQuotes = false;
            else currentVal += char;
        } else {
            if (char === '"') inQuotes = true;
            else if (char === ',') { currentRow.push(currentVal); currentVal = ''; }
            else if (char === '\n' || char === '\r') {
                if (char === '\r' && nextChar === '\n') i++;
                if (currentVal || currentRow.length > 0) currentRow.push(currentVal);
                if (currentRow.length > 0) rows.push(currentRow);
                currentRow = []; currentVal = '';
            } else currentVal += char;
        }
    }
    if (currentVal || currentRow.length > 0) { currentRow.push(currentVal); rows.push(currentRow); }
    return rows;
}

async function batchUpload(ops) {
    const chunkSize = 400; 
    const total = ops.length;
    for (let i = 0; i < total; i += chunkSize) {
        const chunk = ops.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        chunk.forEach(op => {
            if (op.type === 'create') {
                const ref = doc(collection(db, 'artifacts', appId, 'public', 'data', 'calls'));
                batch.set(ref, op.data);
            } else {
                const ref = doc(db, 'artifacts', appId, 'public', 'data', 'calls', op.id);
                batch.update(ref, op.data);
            }
        });
        await batch.commit();
        document.getElementById('importStatus').textContent = `PROCESSING ${Math.min(i + chunkSize, total)}/${total}...`;
    }
}

function setupRealtimeListener() {
    const q = collection(db, 'artifacts', appId, 'public', 'data', 'calls');
    onSnapshot(q, (snapshot) => {
        const calls = [];
        snapshot.forEach((doc) => { calls.push({ id: doc.id, ...doc.data() }); });
        allCalls = calls;
        calculateNextIncidentId();
        populateYearSelect(); 
        updateStats();
        updateAddressHistory();
        renderTable();
    }, (error) => {
        console.error("Firestore Error:", error);
        showToast("ERROR LOADING DATA", true);
    });
}

let sortedAddressList = []; 
function updateAddressHistory() {
    const addressCounts = {};
    allCalls.forEach(call => {
        if (call.address) {
            const addr = call.address.trim().toUpperCase();
            if (addr && addr !== 'UNKNOWN') addressCounts[addr] = (addressCounts[addr] || 0) + 1;
        }
    });
    sortedAddressList = Object.entries(addressCounts).sort((a, b) => b[1] - a[1]).map(entry => entry[0]);
}

const addrInput = document.getElementById('address');
const suggestionBox = document.getElementById('addressSuggestions');
if(addrInput && suggestionBox) {
    addrInput.addEventListener('input', function() {
        const val = this.value.toUpperCase();
        if (val.length < 2) { suggestionBox.classList.add('hidden'); return; }
        const matches = sortedAddressList.filter(a => a.includes(val)).slice(0, 5);
        if (matches.length === 0) { suggestionBox.classList.add('hidden'); return; }
        suggestionBox.innerHTML = '';
        matches.forEach(addr => {
            const div = document.createElement('div');
            div.className = "px-4 py-2 hover:bg-gray-700 cursor-pointer text-sm text-gray-300 border-b border-gray-700 last:border-0 uppercase font-medium";
            const regex = new RegExp(`(${val})`, 'gi');
            const highlighted = addr.replace(regex, '<span class="text-blue-400 font-bold">$1</span>');
            div.innerHTML = highlighted;
            div.onclick = () => { addrInput.value = addr; suggestionBox.classList.add('hidden'); };
            suggestionBox.appendChild(div);
        });
        suggestionBox.classList.remove('hidden');
    });
    document.addEventListener('click', function(e) { if (e.target !== addrInput && !suggestionBox.contains(e.target)) suggestionBox.classList.add('hidden'); });
}

window.populateYearSelect = function() {
    const select = document.getElementById('statsYearSelect');
    const years = new Set(allCalls.map(c => c.year));
    const currentYear = new Date().getFullYear();
    years.add(currentYear);
    const sortedYears = Array.from(years).sort((a, b) => b - a);
    const existingSelection = select.value ? parseInt(select.value) : currentStatsYear;
    select.innerHTML = '';
    sortedYears.forEach(year => {
        const opt = document.createElement('option');
        opt.value = year;
        opt.textContent = year;
        if (year === existingSelection) opt.selected = true;
        select.appendChild(opt);
    });
    if (!years.has(existingSelection)) {
        select.value = sortedYears[0];
        currentStatsYear = sortedYears[0];
    } else currentStatsYear = existingSelection;
    document.getElementById('statsTitle').textContent = `${currentStatsYear} Statistics`;
}

window.handleStatsYearChange = function(el) {
    currentStatsYear = parseInt(el.value);
    document.getElementById('statsTitle').textContent = `${currentStatsYear} Statistics`;
    updateStats();
}

function calculateNextIncidentId() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const yearShort = currentYear.toString().slice(-2);
    const thisYearCalls = allCalls.filter(c => c.year === currentYear);
    let maxSeq = 0;
    if (thisYearCalls.length > 0) maxSeq = Math.max(...thisYearCalls.map(c => c.sequence || 0));
    const nextSeq = maxSeq + 1;
    const seqPadded = String(nextSeq).padStart(5, '0');
    const nextId = `${yearShort}HT${seqPadded}`;
    nextIncidentData = { id: nextId, seq: nextSeq, year: currentYear };
    document.getElementById('previewIncidentId').textContent = nextId;
}

const form = document.getElementById('callForm');
function setNowDefaults() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-CA');
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const timeStr = `${h}:${m}`;
    document.getElementById('dispatchDate').value = dateStr;
    document.getElementById('dispatchTime').value = timeStr;
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitBtn');
    const originalBtnText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> SAVING...';
    try {
        const timeInput = document.getElementById('dispatchTime');
        validateTime(timeInput);
        if (timeInput.classList.contains('border-red-500')) throw new Error("Invalid Time");
        calculateNextIncidentId();
        const isMutualAid = document.getElementById('mutualAid').checked;
        const responseType = document.getElementById('responseType').value;
        const emsDisp = (responseType === 'EMS' || responseType === 'Both') ? document.getElementById('emsDisposition').value : null;
        const newCall = {
            incidentNumber: nextIncidentData.id, sequence: nextIncidentData.seq, year: nextIncidentData.year,
            dispatchDate: document.getElementById('dispatchDate').value,
            dispatchTime: document.getElementById('dispatchTime').value,
            callNature: document.getElementById('callNature').value.toUpperCase(),
            responseType: responseType, emsDisposition: emsDisp,
            address: document.getElementById('address').value.toUpperCase(),
            units: document.getElementById('units').value.toUpperCase(),
            mutualAid: isMutualAid,
            mutualAidType: isMutualAid ? document.getElementById('mutualAidType').value : null,
            mutualAidDept: isMutualAid ? document.getElementById('mutualAidDept').value.toUpperCase() : null,
            notes: document.getElementById('notes').value.toUpperCase(),
            createdAt: new Date().toISOString(), createdBy: currentUser.uid
        };
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'calls'), newCall);
        showToast(`CALL ${newCall.incidentNumber} SAVED!`);
        form.reset();
        setNowDefaults();
        document.getElementById('mutualAid').checked = false; 
        toggleMutualAid(); 
        selectType('EMS'); 
        calculateNextIncidentId(); 
    } catch (error) {
        console.error("Save Error:", error);
        if (error.message !== "Invalid Time") showToast("FAILED TO SAVE CALL", true);
    } finally { btn.disabled = false; btn.innerHTML = originalBtnText; }
});

window.sortCalls = function(field) {
    if (currentSort.field === field) currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
    else { currentSort.field = field; currentSort.dir = 'asc'; if(field === 'date' || field === 'incidentNumber') currentSort.dir = 'desc'; }
    renderTable();
}

window.resetFilters = function() {
    document.getElementById('searchInput').value = '';
    document.getElementById('filterStartDate').value = '';
    document.getElementById('filterEndDate').value = '';
    document.getElementById('filterType').value = '';
    document.getElementById('filterDisposition').value = '';
    document.getElementById('filterMutualAid').value = '';
    document.getElementById('filterNatureUnits').value = '';
    currentSort = { field: 'incidentNumber', dir: 'desc' }; 
    renderTable();
}

window.renderTable = function() {
    const tbody = document.getElementById('historyTableBody');
    const searchVal = document.getElementById('searchInput').value.toLowerCase();
    const startVal = document.getElementById('filterStartDate').value;
    const endVal = document.getElementById('filterEndDate').value;
    const typeVal = document.getElementById('filterType').value;
    const dispVal = document.getElementById('filterDisposition').value;
    const maVal = document.getElementById('filterMutualAid').value;
    const natureUnitVal = document.getElementById('filterNatureUnits').value.toLowerCase();

    let filtered = allCalls.filter(call => {
        const globalText = (call.incidentNumber + ' ' + call.address + ' ' + (call.notes || '')).toLowerCase();
        if (searchVal && !globalText.includes(searchVal)) return false;
        if (startVal && call.dispatchDate < startVal) return false;
        if (endVal && call.dispatchDate > endVal) return false;
        if (typeVal && call.responseType !== typeVal) return false;
        if (dispVal && call.emsDisposition !== dispVal) return false;
        if (maVal) {
            if (maVal === 'Yes' && !call.mutualAid) return false;
            if (maVal === 'No' && call.mutualAid) return false;
            if (maVal === 'Given' && call.mutualAidType !== 'Given') return false;
            if (maVal === 'Received' && call.mutualAidType !== 'Received') return false;
        }
        if (natureUnitVal) {
            const nuText = (call.callNature + ' ' + (call.units || '')).toLowerCase();
            if (!nuText.includes(natureUnitVal)) return false;
        }
        return true;
    });

    filtered.sort((a, b) => {
        let valA, valB;
        switch (currentSort.field) {
            case 'incidentNumber':
                if (a.year !== b.year) return currentSort.dir === 'asc' ? a.year - b.year : b.year - a.year;
                return currentSort.dir === 'asc' ? a.sequence - b.sequence : b.sequence - a.sequence;
            case 'date': valA = a.dispatchDate + (a.dispatchTime || ''); valB = b.dispatchDate + (b.dispatchTime || ''); break;
            case 'callNature': valA = a.callNature || ''; valB = b.callNature || ''; break;
            case 'address': valA = a.address || ''; valB = b.address || ''; break;
            case 'responseType': valA = a.responseType || ''; valB = b.responseType || ''; break;
            case 'mutualAid': valA = (a.mutualAid ? '1' : '0') + (a.mutualAidType || ''); valB = (b.mutualAid ? '1' : '0') + (b.mutualAidType || ''); break;
            case 'emsDisposition': valA = a.emsDisposition || ''; valB = b.emsDisposition || ''; break;
            default: valA = ''; valB = '';
        }
        if (valA < valB) return currentSort.dir === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.dir === 'asc' ? 1 : -1;
        return 0;
    });

    document.querySelectorAll('th.sortable i').forEach(icon => { icon.className = 'fa-solid fa-sort ml-1 text-gray-600'; });
    const activeHeader = document.querySelector(`th[onclick="sortCalls('${currentSort.field}')"] i`);
    if(activeHeader) activeHeader.className = `fa-solid fa-sort-${currentSort.dir === 'asc' ? 'up' : 'down'} ml-1 text-blue-400`;

    tbody.innerHTML = '';
    if (filtered.length === 0) { document.getElementById('emptyState').classList.remove('hidden'); return; } 
    else { document.getElementById('emptyState').classList.add('hidden'); }

    filtered.forEach(call => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-750 transition uppercase cursor-pointer";
        tr.onclick = () => openEditModal(call.id); 
        let typeBadge = '';
        if(call.responseType === 'Fire') typeBadge = '<span class="bg-red-900 text-red-200 text-xs px-2 py-1 rounded">FIRE</span>';
        else if(call.responseType === 'EMS') typeBadge = '<span class="bg-blue-900 text-blue-200 text-xs px-2 py-1 rounded">EMS</span>';
        else typeBadge = '<span class="bg-purple-900 text-purple-200 text-xs px-2 py-1 rounded">BOTH</span>';
        let dateDisplay = call.dispatchDate;
        try { const [y, m, d] = call.dispatchDate.split('-'); dateDisplay = `${m}/${d}/${y}`; } catch(e) {}
        let maDisplay = '<span class="text-gray-600">-</span>';
        if (call.mutualAid) {
            const maColor = call.mutualAidType === 'Given' ? 'text-yellow-400' : 'text-green-400';
            const icon = call.mutualAidType === 'Given' ? 'fa-arrow-right' : 'fa-arrow-left';
            maDisplay = `<div class="text-xs"><span class="${maColor} font-bold"><i class="fa-solid ${icon}"></i> ${call.mutualAidType.toUpperCase()}</span><div class="text-gray-400 truncate w-24" title="${call.mutualAidDept}">${call.mutualAidDept}</div></div>`;
        }
        let notesDisplay = call.notes || '';
        if(notesDisplay.length > 50) notesDisplay = notesDisplay.substring(0,50) + '...';
        let dispDisplay = call.emsDisposition || '<span class="text-gray-600">-</span>';
        tr.innerHTML = `<td class="p-4 font-mono font-bold text-white">${call.incidentNumber}</td><td class="p-4 text-gray-300"><div>${dateDisplay}</div><div class="text-xs text-gray-500 font-mono tracking-wide">${call.dispatchTime}</div></td><td class="p-4 font-medium">${call.callNature}</td><td class="p-4 text-gray-400 truncate max-w-[150px]" title="${call.address}">${call.address}</td><td class="p-4">${typeBadge}</td><td class="p-4 text-gray-400 text-xs truncate max-w-[100px]" title="${call.units}">${call.units}</td><td class="p-4">${maDisplay}</td><td class="p-4 text-gray-400 text-xs truncate max-w-[100px]" title="${call.emsDisposition || ''}">${dispDisplay}</td><td class="p-4 text-gray-400 text-xs max-w-[200px]" title="${call.notes}">${notesDisplay}</td>`;
        tbody.appendChild(tr);
    });
}

function getShiftType(dateStr, timeStr) {
    if (!dateStr || !timeStr) return 'Unknown';
    if (systemConfig.holidays && systemConfig.holidays.includes(dateStr)) return 'Volunteer';
    try {
        const [y, m, d] = dateStr.split('-').map(Number);
        const [h, min] = timeStr.split(':').map(Number);
        const dateObj = new Date(y, m - 1, d, h, min);
        const day = dateObj.getDay(); 
        const hour = h;
        if (day >= 1 && day <= 5) { if (hour >= 6 && hour < 18) return 'Day'; } 
        else { if (hour >= 8 && hour < 18) return 'Day'; }
        return 'Volunteer';
    } catch(e) { return 'Unknown'; }
}

function getDaysPassedInYear(year) {
    const counts = [0,0,0,0,0,0,0]; // Sun-Sat
    const start = new Date(year, 0, 1);
    const now = new Date();
    let end;
    if (year === now.getFullYear()) end = now; 
    else end = new Date(year, 11, 31);
    
    // Normalize
    start.setHours(0,0,0,0);
    const endCompare = new Date(end);
    endCompare.setHours(0,0,0,0);
    
    let current = new Date(start);
    let totalDays = 0;
    
    while (current <= endCompare) {
        counts[current.getDay()]++;
        totalDays++;
        current.setDate(current.getDate() + 1);
    }
    return { counts, totalDays };
}

function updateStats() {
    const thisYearCalls = allCalls.filter(c => c.year === currentStatsYear);
    
    document.getElementById('stat-total').textContent = thisYearCalls.length;
    const fireCount = thisYearCalls.filter(c => c.responseType === 'Fire' || c.responseType === 'Both').length;
    const emsCount = thisYearCalls.filter(c => c.responseType === 'EMS' || c.responseType === 'Both').length;
    document.getElementById('stat-fire').textContent = fireCount;
    document.getElementById('stat-ems').textContent = emsCount;

    // --- TIME ANALYSIS (NEW) ---
    const dayCounts = [0,0,0,0,0,0,0]; // Sun - Sat
    const hourCounts = new Array(24).fill(0);
    
    thisYearCalls.forEach(c => {
            if (c.dispatchDate && c.dispatchTime) {
                try {
                const [y, m, d] = c.dispatchDate.split('-').map(Number);
                const [h, min] = c.dispatchTime.split(':').map(Number);
                const dateObj = new Date(y, m - 1, d, h, min);
                
                const dow = dateObj.getDay(); // 0-6
                dayCounts[dow]++;
                
                if (h >= 0 && h < 24) hourCounts[h]++;
                } catch(e) {}
            }
    });

    const { counts: daysPassedCounts, totalDays: totalDaysPassed } = getDaysPassedInYear(currentStatsYear);
    
    // 1. Render DOW Chart
    const dowLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dowContainer = document.getElementById('stats-dow');
    dowContainer.innerHTML = '';
    
    let maxDayAvg = 0;
    const dayAvgs = dayCounts.map((count, i) => {
        const avg = daysPassedCounts[i] > 0 ? (count / daysPassedCounts[i]) : 0;
        if(avg > maxDayAvg) maxDayAvg = avg;
        return avg;
    });

    dowLabels.forEach((label, i) => {
        const avg = dayAvgs[i];
        const width = maxDayAvg > 0 ? (avg / maxDayAvg) * 100 : 0;
        const displayAvg = avg.toFixed(1); // 1 decimal place
        
        const div = document.createElement('div');
        div.innerHTML = `
            <div class="flex justify-between text-xs mb-1 uppercase font-semibold">
                <span class="w-24">${label}</span>
                <span class="text-blue-400">${displayAvg} <span class="text-gray-500 text-[10px] ml-1">(Total: ${dayCounts[i]})</span></span>
            </div>
            <div class="w-full bg-gray-700 rounded-full h-2">
                <div class="bg-blue-500 h-2 rounded-full bar-animate" style="width: ${width}%"></div>
            </div>
        `;
        dowContainer.appendChild(div);
    });

    // 2. Render Hour Chart
    const hourContainer = document.getElementById('stats-hod');
    hourContainer.innerHTML = '';
    
    // Calculate average per hour? Or just show total? 
    // Average per hour = Total Count / Total Days Passed
    let maxHourAvg = 0;
    const hourAvgs = hourCounts.map(count => {
        const avg = totalDaysPassed > 0 ? (count / totalDaysPassed) : 0;
        if(avg > maxHourAvg) maxHourAvg = avg;
        return avg;
    });

    hourAvgs.forEach((avg, i) => {
        const height = maxHourAvg > 0 ? (avg / maxHourAvg) * 100 : 0;
        // Min height 5% for visibility if > 0
        const finalHeight = (avg > 0 && height < 5) ? 5 : height;
        
        const bar = document.createElement('div');
        bar.className = "flex-1 bg-gray-700 hover:bg-red-500 transition-colors rounded-t-sm relative group";
        bar.style.height = `${finalHeight}%`;
        
        // Tooltip
        bar.innerHTML = `
            <div class="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 hidden group-hover:block bg-black text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10 shadow-xl border border-gray-600">
                <div class="font-bold">${String(i).padStart(2,'0')}:00 - ${String(i+1).padStart(2,'0')}:00</div>
                <div>Avg: ${avg.toFixed(2)}</div>
                <div class="text-gray-400">Total: ${hourCounts[i]}</div>
            </div>
        `;
        hourContainer.appendChild(bar);
    });


    // --- MONTHLY BREAKDOWN ---
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const monthlyStats = Array(12).fill(0).map(() => ({ total: 0, fire: 0, ems: 0, both: 0, emsDay: 0, emsVol: 0 }));
    thisYearCalls.forEach(c => {
        if(!c.dispatchDate) return;
        try {
                const [y, m, d] = c.dispatchDate.split('-').map(Number); 
                const monthIndex = m - 1; 
                if(monthIndex >= 0 && monthIndex < 12) {
                    monthlyStats[monthIndex].total++;
                    if(c.responseType === 'Fire') monthlyStats[monthIndex].fire++;
                    else if(c.responseType === 'EMS') monthlyStats[monthIndex].ems++;
                    else if(c.responseType === 'Both') monthlyStats[monthIndex].both++;
                    
                    if (c.responseType === 'EMS' || c.responseType === 'Both') {
                        const shift = getShiftType(c.dispatchDate, c.dispatchTime);
                        if (shift === 'Day') monthlyStats[monthIndex].emsDay++;
                        else monthlyStats[monthIndex].emsVol++;
                    }
                }
        } catch(e) {}
    });

    const monthlyGrid = document.getElementById('stats-monthly-grid');
    monthlyGrid.innerHTML = '';
    months.forEach((month, idx) => {
        const stats = monthlyStats[idx];
        const isActive = stats.total > 0;
        const opacityClass = isActive ? 'opacity-100' : 'opacity-40';
        const card = document.createElement('div');
        card.className = `bg-gray-900 rounded-lg p-4 border border-gray-700 flex flex-col justify-between ${opacityClass}`;
        card.innerHTML = `
            <div class="flex justify-between items-start mb-2"><span class="text-xs font-bold text-gray-500 tracking-widest">${month}</span><span class="text-xl font-bold text-white">${stats.total}</span></div>
            <div class="space-y-1 mt-1 border-b border-gray-700 pb-2 mb-2">
                <div class="flex justify-between items-center text-xs"><span class="text-gray-400 font-semibold"><i class="fa-solid fa-fire text-red-500 mr-1"></i> FIRE</span><span class="text-gray-300 font-mono">${stats.fire}</span></div>
                <div class="flex justify-between items-center text-xs"><span class="text-gray-400 font-semibold"><i class="fa-solid fa-star-of-life text-blue-500 mr-1"></i> EMS</span><span class="text-gray-300 font-mono">${stats.ems}</span></div>
                <div class="flex justify-between items-center text-xs"><span class="text-gray-400 font-semibold"><i class="fa-solid fa-layer-group text-purple-500 mr-1"></i> BOTH</span><span class="text-gray-300 font-mono">${stats.both}</span></div>
            </div>
            <div class="grid grid-cols-2 gap-1 text-[10px] uppercase">
                <div class="bg-blue-900/30 rounded px-1 py-0.5 text-center"><span class="block text-blue-400 font-bold">DAY</span><span class="text-white font-mono">${stats.emsDay}</span></div>
                <div class="bg-orange-900/30 rounded px-1 py-0.5 text-center"><span class="block text-orange-400 font-bold">VOL</span><span class="text-white font-mono">${stats.emsVol}</span></div>
            </div>
        `;
        monthlyGrid.appendChild(card);
    });

    // --- DETAILED STATS ---
    const natureCounts = {};
    thisYearCalls.forEach(c => { const n = c.callNature || 'UNKNOWN'; natureCounts[n] = (natureCounts[n] || 0) + 1; });
    const sortedNatures = Object.entries(natureCounts).sort((a, b) => b[1] - a[1]).slice(0, 5); 
    const natureListEl = document.getElementById('stats-natures');
    natureListEl.innerHTML = '';
    if (sortedNatures.length === 0) natureListEl.innerHTML = '<div class="text-gray-500 text-sm italic">No data available</div>';
    else {
        const maxCount = sortedNatures[0][1];
        sortedNatures.forEach(([name, count]) => {
            const barWidth = (count / maxCount) * 100; 
            const row = document.createElement('div');
            row.innerHTML = `<div class="flex justify-between text-xs mb-1 uppercase font-semibold"><span>${name}</span><span>${count}</span></div><div class="w-full bg-gray-700 rounded-full h-2"><div class="bg-blue-500 h-2 rounded-full transition-all duration-500" style="width: ${barWidth}%"></div></div>`;
            natureListEl.appendChild(row);
        });
    }

    const addressCounts = {};
    thisYearCalls.forEach(c => {
        let addr = c.address ? c.address.trim().toUpperCase() : 'UNKNOWN';
        if (addr.includes('I 70')) addr = 'I 70'; 
        if (addr !== 'UNKNOWN' && addr !== '') addressCounts[addr] = (addressCounts[addr] || 0) + 1;
    });
    const sortedAddresses = Object.entries(addressCounts).sort((a, b) => b[1] - a[1]).slice(0, 5); 
    const addrListEl = document.getElementById('stats-addresses');
    addrListEl.innerHTML = '';
    if (sortedAddresses.length === 0) addrListEl.innerHTML = '<div class="text-gray-500 text-sm italic">No data available</div>';
    else {
            const maxAddrCount = sortedAddresses[0][1];
            sortedAddresses.forEach(([addr, count]) => {
            const barWidth = (count / maxAddrCount) * 100;
            const row = document.createElement('div');
            row.innerHTML = `<div class="flex justify-between text-xs mb-1 uppercase font-semibold"><span class="truncate pr-2" title="${addr}">${addr}</span><span>${count}</span></div><div class="w-full bg-gray-700 rounded-full h-2"><div class="bg-purple-500 h-2 rounded-full transition-all duration-500" style="width: ${barWidth}%"></div></div>`;
            addrListEl.appendChild(row);
            });
    }

    // --- MUTUAL AID STATS ---
    let givenCount = 0; 
    let receivedCount = 0; 
    let givenDay = 0; 
    let givenVol = 0; 
    let recDay = 0; 
    let recVol = 0; 
    
    // Create two separate counters
    const maGivenDepts = {};
    const maReceivedDepts = {};

    thisYearCalls.forEach(c => {
        if (c.responseType === 'Fire') return;
        
        if (c.mutualAid) {
            const shift = getShiftType(c.dispatchDate, c.dispatchTime);
            
            // Handle Given
            if (c.mutualAidType === 'Given') {
                givenCount++;
                if (shift === 'Day') givenDay++; else givenVol++; 
                
                // Track Given Depts
                if (c.mutualAidDept) {
                    const depts = c.mutualAidDept.split(',').map(s => s.trim());
                    depts.forEach(d => { if(d) maGivenDepts[d] = (maGivenDepts[d] || 0) + 1; });
                }
            }
            
            // Handle Received
            if (c.mutualAidType === 'Received') {
                receivedCount++;
                if (shift === 'Day') recDay++; else recVol++;
                
                // Track Received Depts
                if (c.mutualAidDept) {
                    const depts = c.mutualAidDept.split(',').map(s => s.trim());
                    depts.forEach(d => { if(d) maReceivedDepts[d] = (maReceivedDepts[d] || 0) + 1; });
                }
            }
        }
    });

    document.getElementById('stat-ma-given').textContent = givenCount;
    document.getElementById('stat-ma-given-day').textContent = givenDay;
    document.getElementById('stat-ma-given-vol').textContent = givenVol;
    document.getElementById('stat-ma-received').textContent = receivedCount;
    document.getElementById('stat-ma-received-day').textContent = recDay;
    document.getElementById('stat-ma-received-vol').textContent = recVol;

    // Helper to render list
    const renderMaList = (dataObj, containerId) => {
        const sorted = Object.entries(dataObj).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        
        if (sorted.length === 0) {
            container.innerHTML = '<li class="text-gray-500 text-xs italic">No data available</li>';
            return;
        }

        sorted.forEach(([name, count]) => {
            const li = document.createElement('li');
            li.className = "flex justify-between border-b border-gray-700 py-1 last:border-0";
            li.innerHTML = `<span class="truncate pr-2" title="${name}">${name}</span> <span class="font-bold text-white">${count}</span>`;
            container.appendChild(li);
        });
    };

    // Render both lists
    renderMaList(maGivenDepts, 'stats-ma-given-depts');
    renderMaList(maReceivedDepts, 'stats-ma-received-depts');

    let dayCrewCount = 0; let volunteerCount = 0; const volDispCounts = {};
    thisYearCalls.forEach(c => {
        if (c.responseType === 'Fire') return;
        const shift = getShiftType(c.dispatchDate, c.dispatchTime);
        if (shift === 'Day') dayCrewCount++;
        else if (shift === 'Volunteer') {
            volunteerCount++;
            const disp = c.emsDisposition || 'NOT RECORDED';
            volDispCounts[disp] = (volDispCounts[disp] || 0) + 1;
        }
    });
    document.getElementById('stat-crew-day').textContent = dayCrewCount;
    document.getElementById('stat-crew-vol').textContent = volunteerCount;
    
    // NEW PERCENTAGE CALCULATION
    let volPct = "0.0";
    const noCrewCount = volDispCounts['NO CREW/MA'] || 0;
    if (volunteerCount > 0) {
        // (Total Vol Runs - NO CREW/MA) / Total Vol Runs
        volPct = (((volunteerCount - noCrewCount) / volunteerCount) * 100).toFixed(1);
    }
    document.getElementById('stat-crew-vol-pct').textContent = `${volPct}% Handled`;

    const volDispListEl = document.getElementById('stats-vol-dispo');
    volDispListEl.innerHTML = '';
    const sortedVolDisps = Object.entries(volDispCounts).sort((a, b) => b[1] - a[1]);
    if (sortedVolDisps.length === 0) volDispListEl.innerHTML = '<div class="text-gray-500 text-sm italic">No data available</div>';
    else {
        const maxCount = sortedVolDisps[0][1];
        sortedVolDisps.forEach(([name, count]) => {
            const barWidth = (count / maxCount) * 100;
            const row = document.createElement('div');
            row.innerHTML = `<div class="flex justify-between text-xs mb-1 uppercase font-semibold"><span>${name}</span><span>${count}</span></div><div class="w-full bg-gray-700 rounded-full h-2"><div class="bg-orange-500 h-2 rounded-full transition-all duration-500" style="width: ${barWidth}%"></div></div>`;
            volDispListEl.appendChild(row);
        });
    }
}

window.showToast = function(msg, isError = false) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toastMessage');
    toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-xl transform transition-all duration-300 z-50 flex items-center gap-3 ${isError ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`;
    msgEl.textContent = msg;
    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => { toast.classList.add('translate-y-20', 'opacity-0'); }, 3000);
}

window.toggleMutualAid = function() {
    const chk = document.getElementById('mutualAid');
    const fields = document.getElementById('mutualAidFields');
    const inputs = fields.querySelectorAll('input, select');
    if (chk.checked) { fields.classList.remove('hidden'); inputs.forEach(i => i.required = true); handleMutualAidTypeChange(); } 
    else { fields.classList.add('hidden'); inputs.forEach(i => i.required = false); }
}

window.switchTab = function(tabName) {
    const entryTab = document.getElementById('tab-entry');
    const historyTab = document.getElementById('tab-history');
    const statsTab = document.getElementById('tab-stats');
    const btnEntry = document.getElementById('btn-entry');
    const btnHistory = document.getElementById('btn-history');
    const btnStats = document.getElementById('btn-stats');
    entryTab.classList.add('hidden');
    historyTab.classList.add('hidden');
    statsTab.classList.add('hidden');
    const inactiveClass = "px-4 py-2 rounded-lg bg-gray-700 text-gray-300 font-medium hover:bg-gray-600 transition border border-gray-600 uppercase text-sm tracking-wider";
    const activeClass = "px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition shadow-md border border-red-500 uppercase text-sm tracking-wider";
    btnEntry.className = inactiveClass;
    btnHistory.className = inactiveClass;
    btnStats.className = inactiveClass;
    if (tabName === 'entry') { entryTab.classList.remove('hidden'); btnEntry.className = activeClass; } 
    else if (tabName === 'history') { historyTab.classList.remove('hidden'); btnHistory.className = activeClass; renderTable(); } 
    else if (tabName === 'stats') { statsTab.classList.remove('hidden'); btnStats.className = activeClass; updateStats(); }
}

window.resetForm = function() {
    document.getElementById('callForm').reset();
    setNowDefaults();
    toggleMutualAid(); 
    selectType('EMS'); 
    calculateNextIncidentId(); 
}