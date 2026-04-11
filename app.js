let myColor = "SPECTATOR";
// Automatically detect if we are running locally or on the live internet
const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

// We will paste your actual cloud URL here once we deploy the backend in Phase 3!
const PROD_BACKEND_URL = "https://dichess.onrender.com"; 

const SERVER_URL = isLocal ? "http://localhost:8080" : PROD_BACKEND_URL;

const pieceMap = { "wK": "♔", "wQ": "♕", "wR": "♖", "wB": "♗", "wN": "♘", "wP": "♙", "bK": "♚", "bQ": "♛", "bR": "♜", "bB": "♝", "bN": "♞", "bP": "♟", "": "" };
const pieceValues = { 'Q': 9, 'R': 5, 'B': 3, 'N': 3, 'P': 1, 'K': 0 };
const startingCounts = { 'Q': 1, 'R': 2, 'B': 2, 'N': 2, 'P': 8 };

let moveCounter = 1;
let selectedSquare = null; 
let boardHistory = []; 
let currentViewIndex = -1; 
let lastKnownStatus = "White's Turn"; 

// --- NEW: CLOCK VARIABLES ---
let whiteTimeSeconds = 600; // 10 minutes
let blackTimeSeconds = 600;
let timerInterval = null;

// ==========================================
// 1. THE WEBSOCKET CONNECTION (NEW!)
// ==========================================
let stompClient = null;

function connectWebSocket() {
    const socket = new SockJS(`${SERVER_URL}/ws`);
    stompClient = Stomp.over(socket);
    
    // Turn off debug logging in console for a cleaner experience
    stompClient.debug = null; 

    stompClient.connect({}, function (frame) {
        console.log('Connected to Multiplayer Socket!');
        
        // Subscribe to the radio channel
        stompClient.subscribe('/topic/game', function (message) {
            const data = JSON.parse(message.body);
            
            if (data.type === "RESET") {
                executeLocalReset();
            } else if (data.type === "MOVE") {
                executeLiveMoveUpdate(data);
            }
        });
    });
}

// --- NEW: MATCHMAKING ---
async function joinGame() {
    const response = await fetch(`${SERVER_URL}/join`);
    myColor = await response.text(); // Returns "WHITE", "BLACK", or "SPECTATOR"
    
    // Flip the board if the player is Black!
    const leftColumn = document.querySelector(".left-column");
    if (myColor === "BLACK") {
        leftColumn.classList.add("flipped-board");
    } else {
        leftColumn.classList.remove("flipped-board");
    }

    // Tell them who they are in the status bar
    lastKnownStatus = `You are playing as: ${myColor}`;
    document.getElementById("status").innerText = lastKnownStatus;
}

// When the server shouts "MOVE!" or "TIMEOUT", browsers run this function
function executeLiveMoveUpdate(data) {
    lastKnownStatus = data.status;
    document.getElementById("status").innerText = lastKnownStatus;

    // Log the notation (this safely ignores the empty pieceCode from timeouts)
    logAlgebraicNotation(data.pieceCode, data.startX, data.startY, data.endX, data.endY, data.status, data.promotion);
    
    // Sync the visual clock with Java's official millisecond clock
    if (data.whiteTime !== undefined && data.blackTime !== undefined) {
        whiteTimeSeconds = Math.floor(data.whiteTime / 1000);
        blackTimeSeconds = Math.floor(data.blackTime / 1000);
        updateClockUI();
        startTimers(); 
    }

    // Update Timeline and Redraw
    boardHistory.push(data.grid);
    currentViewIndex = boardHistory.length - 1;

    // This will no longer crash because Java is sending the correct array!
    drawBoard(data.grid);
    updateMaterial(data.grid);

    // Handle Win/Draw/Timeout visuals
    document.querySelectorAll('.check-square').forEach(el => el.classList.remove('check-square'));

    // THE FIX: Catch the timeout and trigger the overlay
    if (data.status.includes("TIME_OUT")) {
        const winner = data.status.includes("White wins") ? "White" : "Black";
        displayOverlay(`TIME OUT!<br>${winner} wins!`);
    } else if (data.status.includes("CHECKMATE")) {
        const winner = data.status.includes("WHITE wins") ? "White" : "Black";
        displayOverlay(`CHECKMATE!<br>${winner} wins!`);
        highlightKingInCheck(data.status, data.grid);
    } else if (data.status.includes("DRAW")) {
        displayOverlay(`${data.status.replace("DRAW! ", "")}<br>Game is a Draw.`);
    } else if (data.status.includes("CHECK")) {
        highlightKingInCheck(data.status, data.grid);
    }
}

// ==========================================
// 2. THE DUMB "ACTION" FUNCTIONS
// ==========================================
async function attemptMove(startX, startY, endX, endY, pieceCode) {
    clearValidMoves(); 
    const startSquareDiv = document.getElementById(`square-${startX}-${startY}`);

    let promotionCode = "";
    if ((pieceCode === "wP" && startX === 6 && endX === 7) || (pieceCode === "bP" && startX === 1 && endX === 0)) {
        promotionCode = await triggerPromotionUI(pieceCode[0]); 
    }

    // Include pieceCode in the request to Java!
    let url = `${SERVER_URL}/move?startX=${startX}&startY=${startY}&endX=${endX}&endY=${endY}&pieceCode=${pieceCode}`;
    if (promotionCode) url += `&promotion=${promotionCode}`;

    const response = await fetch(url);
    const statusText = await response.text();
    
    // Only handle errors locally. If it's a success, DO NOTHING! 
    // The WebSocket will instantly catch the success and run executeLiveMoveUpdate()
    if (statusText.includes("ERROR")) {
        document.getElementById("status").innerText = statusText;
        startSquareDiv.classList.add("invalid-move");
        setTimeout(() => startSquareDiv.classList.remove("invalid-move"), 800);
    }
}

async function resetGame() {
    // Tell Java to reset. The WebSocket will broadcast the reset to everyone.
    await fetch(`${SERVER_URL}/reset`);
}

function executeLocalReset() {
    hideOverlay();
    document.getElementById("move-log").innerHTML = ""; 
    moveCounter = 1;
    selectedSquare = null;
    boardHistory = [];
    currentViewIndex = -1;
    lastKnownStatus = "White's Turn";
    document.getElementById("status").innerText = "Game Reset. White's Turn.";
    // NEW: Reset clocks
    whiteTimeSeconds = 600;
    blackTimeSeconds = 600;
    updateClockUI();    
    startTimers();
    fetchBoard(); // Re-fetch the fresh board
}

// ==========================================
// 3. UI, TIMELINE, AND MATERIAL LOGIC (Unchanged)
// ==========================================
async function fetchBoard() {
    try {
        const response = await fetch(`${SERVER_URL}/board?t=${new Date().getTime()}`);
        const grid = await response.json();
        boardHistory = [grid];
        currentViewIndex = 0;
        drawBoard(grid);
        updateMaterial(grid);
    } catch (error) {
        document.getElementById("status").innerText = "Error connecting to server.";
    }
}

function drawBoard(grid) {
    const boardDiv = document.getElementById("chessboard");
    boardDiv.innerHTML = ""; 

    for (let row = 7; row >= 0; row--) {
        for (let col = 0; col < 8; col++) {
            const square = document.createElement("div");
            square.className = `square ${(row + col) % 2 === 0 ? 'dark' : 'light'}`;
            square.id = `square-${row}-${col}`;

            const pieceCode = grid[row][col];

            square.addEventListener("dragover", e => e.preventDefault());
            square.addEventListener("dragenter", e => e.currentTarget.classList.add("drag-over"));
            square.addEventListener("dragleave", e => e.currentTarget.classList.remove("drag-over"));
            square.addEventListener("drop", (e) => handleDrop(e, row, col));
            square.onclick = () => handleSquareClick(row, col, square, pieceCode);

            if (pieceCode) {
                const pieceSpan = document.createElement("span");
                pieceSpan.className = `piece-symbol ${pieceCode[0] === 'w' ? 'white-piece' : 'black-piece'}`;
                pieceSpan.innerText = pieceMap[pieceCode];
                pieceSpan.draggable = true;
                
                pieceSpan.addEventListener("dragstart", (e) => {
                    // NEW: SECURITY LOCK - Only touch your own pieces!
                    if (myColor === "SPECTATOR" || pieceCode[0] !== (myColor === "WHITE" ? 'w' : 'b')) {
                        e.preventDefault(); 
                        return;
                    }
                    if (currentViewIndex < boardHistory.length - 1) { e.preventDefault(); return; }
                    if (selectedSquare) { selectedSquare.div.classList.remove("selected"); selectedSquare = null; }
                    e.dataTransfer.setData("text/plain", JSON.stringify({ startX: row, startY: col, piece: pieceCode }));
                    setTimeout(() => pieceSpan.classList.add("dragging"), 0);
                    showValidMoves(row, col);
                });

                pieceSpan.addEventListener("dragend", () => pieceSpan.classList.remove("dragging"));
                square.appendChild(pieceSpan);
            }
            boardDiv.appendChild(square);
        }
    }
}

function handleSquareClick(row, col, squareDiv, pieceCode) {
    if (currentViewIndex < boardHistory.length - 1) return;
    if (selectedSquare === null) {
        // NEW: SECURITY LOCK - Only click your own pieces!
        if (pieceCode !== "") {
            if (myColor === "SPECTATOR" || pieceCode[0] !== (myColor === "WHITE" ? 'w' : 'b')) {
                return; // Ignore the click
            }
            selectedSquare = { x: row, y: col, div: squareDiv, piece: pieceCode };
            squareDiv.classList.add("selected");
            showValidMoves(row, col);
        }
    } else {
        const startX = selectedSquare.x; const startY = selectedSquare.y; const movingPiece = selectedSquare.piece;
        selectedSquare.div.classList.remove("selected"); selectedSquare = null;
        clearValidMoves(); 
        if (startX === row && startY === col) return;
        attemptMove(startX, startY, row, col, movingPiece);
    }
}

function handleDrop(e, endX, endY) {
    e.preventDefault(); e.currentTarget.classList.remove("drag-over"); 
    if (currentViewIndex < boardHistory.length - 1) return;
    const dragData = JSON.parse(e.dataTransfer.getData("text/plain"));
    if (dragData.startX === endX && dragData.startY === endY) return;
    attemptMove(dragData.startX, dragData.startY, endX, endY, dragData.piece);
}

function updateMaterial(grid) {
    let whitePoints = 0; let blackPoints = 0;
    let whiteCounts = { 'Q': 0, 'R': 0, 'B': 0, 'N': 0, 'P': 0 }; let blackCounts = { 'Q': 0, 'R': 0, 'B': 0, 'N': 0, 'P': 0 };

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = grid[r][c];
            if (p && p[1] !== 'K') {
                if (p[0] === 'w') { whitePoints += pieceValues[p[1]]; whiteCounts[p[1]]++; } 
                else { blackPoints += pieceValues[p[1]]; blackCounts[p[1]]++; }
            }
        }
    }

    let capturedByBlack = []; let capturedByWhite = [];
    for (const type in startingCounts) {
        let missingWhite = Math.max(0, startingCounts[type] - whiteCounts[type]);
        for (let i = 0; i < missingWhite; i++) capturedByBlack.push('w' + type);
        let missingBlack = Math.max(0, startingCounts[type] - blackCounts[type]);
        for (let i = 0; i < missingBlack; i++) capturedByWhite.push('b' + type);
    }

    const diff = whitePoints - blackPoints;
    let whiteAdvantage = diff > 0 ? `+${diff}` : ""; let blackAdvantage = diff < 0 ? `+${Math.abs(diff)}` : "";

    renderCapturedPieces("captured-by-black", capturedByBlack, blackAdvantage);
    renderCapturedPieces("captured-by-white", capturedByWhite, whiteAdvantage);
}

function renderCapturedPieces(containerId, pieces, advantage) {
    const container = document.getElementById(containerId);
    container.innerHTML = ""; 
    const sortOrder = { 'Q': 1, 'R': 2, 'B': 3, 'N': 4, 'P': 5 };
    pieces.sort((a, b) => sortOrder[a[1]] - sortOrder[b[1]]);

    pieces.forEach(p => {
        const span = document.createElement("span"); span.innerText = pieceMap[p];
        span.className = p[0] === 'w' ? 'captured-white' : 'captured-black';
        container.appendChild(span);
    });

    if (advantage) {
        const advSpan = document.createElement("span"); advSpan.className = "advantage-score"; advSpan.innerText = advantage;
        container.appendChild(advSpan);
    }
}

function updateTimelineUI() {
    const boardDiv = document.getElementById("chessboard"); const statusDiv = document.getElementById("status");
    if (currentViewIndex < boardHistory.length - 1) {
        boardDiv.classList.add("review-mode"); statusDiv.innerText = `REVIEW MODE: Viewing Move ${currentViewIndex}`; hideOverlay(); 
    } else {
        boardDiv.classList.remove("review-mode"); statusDiv.innerText = lastKnownStatus;
    }
    drawBoard(boardHistory[currentViewIndex]);
    updateMaterial(boardHistory[currentViewIndex]); 
    document.querySelectorAll('.check-square').forEach(el => el.classList.remove('check-square'));
}

function viewPrevious() { if (currentViewIndex > 0) { currentViewIndex--; updateTimelineUI(); } }
function viewNext() { if (currentViewIndex < boardHistory.length - 1) { currentViewIndex++; updateTimelineUI(); } }
function viewFirst() { if (currentViewIndex !== 0) { currentViewIndex = 0; updateTimelineUI(); } }
function viewLive() {
    if (currentViewIndex !== boardHistory.length - 1) {
        currentViewIndex = boardHistory.length - 1; updateTimelineUI();
        if (lastKnownStatus.includes("CHECKMATE") || lastKnownStatus.includes("DRAW")) {
            const msg = lastKnownStatus.includes("CHECKMATE") ? `CHECKMATE!<br>${lastKnownStatus.includes("WHITE") ? "White" : "Black"} wins!` : `${lastKnownStatus.replace("DRAW! ", "")}<br>Game is a Draw.`;
            displayOverlay(msg);
        }
    }
}

function triggerPromotionUI(colorChar) {
    return new Promise((resolve) => {
        const modal = document.getElementById("promotion-modal"); const optionsDiv = document.getElementById("promotion-options"); optionsDiv.innerHTML = ""; 
        ["Q", "R", "B", "N"].forEach(type => {
            const btn = document.createElement("div"); btn.className = "promo-choice";
            const pieceCode = colorChar + type; btn.className += (colorChar === 'w') ? " white-piece" : " black-piece";
            btn.innerText = pieceMap[pieceCode];
            btn.onclick = () => { modal.classList.add("hidden"); resolve(type); };
            optionsDiv.appendChild(btn);
        });
        modal.classList.remove("hidden");
    });
}

async function showValidMoves(startX, startY) {
    clearValidMoves(); 
    const response = await fetch(`${SERVER_URL}/validMoves?startX=${startX}&startY=${startY}&t=${new Date().getTime()}`);
    const validCoordinates = await response.json();
    validCoordinates.forEach(coord => {
        const square = document.getElementById(`square-${coord[0]}-${coord[1]}`);
        const hintDot = document.createElement("div"); hintDot.className = "valid-move-hint"; square.appendChild(hintDot);
    });
}

function clearValidMoves() { document.querySelectorAll(".valid-move-hint").forEach(dot => dot.remove()); }

function logAlgebraicNotation(pieceCode, startX, startY, endX, endY, statusText, promotionCode) {
    // NEW: If there is no piece code (like during a timeout broadcast), ignore the log!
    if (!pieceCode) return;
    const startSquare = `${String.fromCharCode(97 + startY)}${startX + 1}`; const endSquare = `${String.fromCharCode(97 + endY)}${endX + 1}`;
    let notation = `${moveCounter}. ${pieceMap[pieceCode]} ${startSquare} → ${endSquare}`;
    if (promotionCode) notation += `=${pieceMap[pieceCode[0] + promotionCode]}`;
    if (statusText.includes("CHECKMATE")) notation += " #"; else if (statusText.includes("CHECK")) notation += " +"; else if (statusText.includes("DRAW")) notation += " ½-½";

    const logDiv = document.getElementById("move-log"); const entry = document.createElement("div");
    entry.className = "log-entry"; entry.innerText = notation; logDiv.appendChild(entry); logDiv.scrollTop = logDiv.scrollHeight; 
    moveCounter++;
}

function highlightKingInCheck(text, grid) {
    let colorToHighlight = text.includes("wins") ? (text.includes("WHITE") ? "bK" : "wK") : (text.includes("BLACK") ? "bK" : "wK");
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (grid[r][c] === colorToHighlight) { document.getElementById(`square-${r}-${c}`).classList.add("check-square"); return; }
        }
    }
}

function displayOverlay(message) { document.getElementById("overlay-message").innerHTML = message; document.getElementById("overlay").classList.remove("hidden"); }
function hideOverlay() { document.getElementById("overlay").classList.add("hidden"); }

// --- NEW: CLOCK LOGIC ---
function startTimers() {
    clearInterval(timerInterval); // Stop any existing loops

    // If the game is over, don't start the clock
    if (lastKnownStatus.includes("CHECKMATE") || lastKnownStatus.includes("DRAW") || lastKnownStatus.includes("TIME_OUT")) {
        return; 
    }

    // Tick exactly 1 second off the active player's clock
    timerInterval = setInterval(() => {
        
        // THE FIX: Convert the status to ALL CAPS so it always matches Java's Enum!
        const statusUpper = lastKnownStatus.toUpperCase();

        if (statusUpper.includes("WHITE")) {
            whiteTimeSeconds--;
        } else if (statusUpper.includes("BLACK")) {
            blackTimeSeconds--;
        }
        
        updateClockUI();

        if (whiteTimeSeconds <= 0 || blackTimeSeconds <= 0) {
            clearInterval(timerInterval);
            
            // NEW: Instantly ping the server to verify and end the game!
            fetch(`${SERVER_URL}/timeout`);
        }
    }, 1000);
}

function updateClockUI() {
    const formatTime = (totalSeconds) => {
        if (totalSeconds <= 0) return "00:00";
        const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    const wClock = document.getElementById("white-clock");
    const bClock = document.getElementById("black-clock");

    wClock.innerText = formatTime(whiteTimeSeconds);
    bClock.innerText = formatTime(blackTimeSeconds);

    // Add dramatic red pulsing if under 30 seconds!
    whiteTimeSeconds < 30 ? wClock.classList.add("time-low") : wClock.classList.remove("time-low");
    blackTimeSeconds < 30 ? bClock.classList.add("time-low") : bClock.classList.remove("time-low");
}

// INITIALIZE APP
(async function init() {
    await joinGame(); // Get identity FIRST
    connectWebSocket();
    fetchBoard();
})();