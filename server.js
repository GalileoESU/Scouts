const express = require('express');
const cors = require('cors');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// --- SECURE SUPABASE CONNECTION ---
// You will get these credentials from your Supabase Dashboard settings!
const SUPABASE_URL = 'https://ebtcoqdfhpmjlaevinvp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_sJR22My1jObDNxGm770e3w_TNW279jd';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- SECURE HOST LOGIN ENDPOINT ---
// This runs on the server, completely hidden from the user's browser.
app.post('/api/host/login', (req, res) => {
    const { username, pin } = req.body;
    
    if (username === "BenLewis1" && pin === "4070") {
        return res.json({ success: true, token: "secure_session_token_xyz123" });
    } else {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
});

// --- SECURE TEAM CREATION ENDPOINT ---
app.post('/api/team/create', async (req, res) => {
    const { teamName, pin } = req.body;

    // 1. Check if the team name already exists in Supabase
    const { data: existingTeam } = await supabase
        .from('teams')
        .select('team_name')
        .eq('team_name', teamName)
        .single();

    if (existingTeam) {
        return res.status(400).json({ success: false, message: "Team Name already used" });
    }

    // 2. Count current teams to auto-generate the 3-digit sequential ID
    const { count } = await supabase
        .from('teams')
        .select('*', { count: 'exact', head: true });

    const nextId = String(count + 1).padStart(3, '0'); // e.g., 1 -> "001"

    // 3. Save the new team securely to the database
    const { error } = await supabase
        .from('teams')
        .insert([{ team_id: nextId, team_name: teamName, pin: pin }]);

    if (error) return res.status(500).json({ success: false, message: "Database error" });

    return res.json({ success: true, teamId: nextId });
});

// Start the server engine on the port Render assigns
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server securely running on port ${PORT}`);
});

// --- EXCEL TEMPLATE ENGINE & INTERPRETER ---

// 1. Endpoint providing the standard template layout file structure down to the host
app.get('/api/host/download-template', (req, res) => {
    const headers = [["PostNo", "PostLocation", "PostDescription", "PostImage", "PostClue1", "PostClue2", "PostClue3"]];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(headers);
    XLSX.utils.book_append_sheet(wb, ws, "GameTemplate");
    
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=ScoutGameTemplate.xlsx');
    res.send(buf);
});

// 2. Endpoint inspecting uploaded spreadsheets for parsing assets
app.post('/api/host/upload-game', (req, res) => {
    // In production, an upload middleware like 'multer' will pass this file buffer here
    try {
        const workbook = XLSX.read(req.body.fileBuffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet);
        
        let checkpointsCount = rows.length;
        let missingMediaFiles = [];

        rows.forEach(row => {
            // Check files logic: if it ends in extension notation, add to requirements tracker list
            ['PostImage', 'PostClue1', 'PostClue2', 'PostClue3'].forEach(col => {
                if (row[col] && row[col] !== "N/A" && row[col].includes('.')) {
                    missingMediaFiles.push(row[col]);
                }
            });
        });

        res.json({
            success: true,
            checkpoints: checkpointsCount,
            requiredFiles: missingMediaFiles
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to read excel file template structures" });
    }
});