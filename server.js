const express = require('express');
const cors = require('cors');
const XLSX = require('xlsx');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// --- SECURE SUPABASE CONNECTION ---
const SUPABASE_URL = 'https://ebtcoqdfhpmjlaevinvp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_sJR22My1jObDNxGm770e3w_TNW279jd'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- SECURE HOST LOGIN ---
app.post('/api/host/login', (req, res) => {
    const { username, pin } = req.body;
    if (username === "BenLewis1" && pin === "4070") {
        return res.json({ success: true, token: "secure_session_token_xyz123" });
    }
    return res.status(401).json({ success: false, message: "Invalid credentials" });
});

// --- EXCEL UPLOAD, STORAGE & DELETE ROUTINES ---
app.post('/api/host/upload-game', upload.single('gameFile'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "Missing upload data" });
        
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        const { error } = await supabase.from('games').insert([{
            filename: req.file.originalname,
            stations_json: rawRows,
            is_active: false
        }]);

        if (error) throw error;
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/host/games', async (req, res) => {
    const { data } = await supabase.from('games').select('*').order('created_at', { ascending: false });
    return res.json({ success: true, games: data || [] });
});

app.post('/api/host/games/activate', async (req, res) => {
    const { id } = req.body;
    try {
        await supabase.from('games').update({ is_active: false }).neq('id', 0);
        const { error } = await supabase.from('games').update({ is_active: true }).eq('id', id);
        if (error) throw error;
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/host/games/delete', async (req, res) => {
    const { id } = req.body;
    try {
        const { error } = await supabase.from('games').delete().eq('id', id);
        if (error) throw error;
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// --- REAL-TIME TEAM DATA TRACKING ---
app.get('/api/host/teams', async (req, res) => {
    const { data: teams } = await supabase.from('teams').select('*').order('created_at', { ascending: false });
    return res.json({ success: true, teams: teams || [] });
});

app.get('/api/host/stats', async (req, res) => {
    try {
        const { count: teamCount } = await supabase.from('teams').select('*', { count: 'exact', head: true });
        const { count: scanCount } = await supabase.from('logs').select('*', { count: 'exact', head: true });
        return res.json({ success: true, teams: teamCount || 0, scans: scanCount || 0 });
    } catch (err) {
        return res.json({ success: true, teams: 0, scans: 0 });
    }
});

app.post('/api/host/teams/delete', async (req, res) => {
    const { all, teamId } = req.body;
    try {
        if (all) {
            await supabase.from('teams').delete().neq('team_id', '000');
        } else {
            await supabase.from('teams').delete().eq('team_id', teamId);
        }
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// --- CLEAN TRANSACTUAL TEAM CREATION ROUTING ---
app.post('/api/team/create', async (req, res) => {
    const { teamName, pin } = req.body;
    try {
        const calculatedId = String(Math.floor(Math.random() * 900) + 100);
        const { error } = await supabase.from('teams').insert([
            { team_id: calculatedId, team_name: teamName, pin: pin }
        ]);
        if (error) throw error;
        return res.json({ success: true, teamId: calculatedId });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/team/rejoin', async (req, res) => {
    const { teamName, pin } = req.body;
    try {
        const { data: team } = await supabase.from('teams').select('team_id, pin').eq('team_name', teamName).single();
        if (team && team.pin === pin) return res.json({ success: true, teamId: team.team_id });
        return res.status(401).json({ success: false });
    } catch (err) {
        return res.status(500).json({ success: false });
    }
});

app.get('/api/host/download-template', (req, res) => {
    const headers = [["PostNo", "PostLocation", "PostDescription", "PostClue1", "PostClue2"]];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(headers);
    XLSX.utils.book_append_sheet(wb, ws, "GameTemplate");
    res.setHeader('Content-Disposition', 'attachment; filename=ScoutGameTemplate.xlsx');
    res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));