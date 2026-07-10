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
            await supabase.from('logs').delete().neq('id', 0);
        } else {
            await supabase.from('teams').delete().eq('team_id', teamId);
            await supabase.from('logs').delete().eq('team_id', teamId);
        }
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// --- ANNOUNCEMENTS BROADCAST SYSTEM ---
app.post('/api/host/announcements', async (req, res) => {
    const { text } = req.body;
    try {
        const { error } = await supabase.from('announcements').insert([{ text }]);
        if (error) throw error;
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/team/announcements', async (req, res) => {
    const { data } = await supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(5);
    return res.json({ success: true, announcements: data || [] });
});

// --- SCANNING MATCH HANDLING & GAME PLAY ---
app.post('/api/team/scan', async (req, res) => {
    const { teamId, qrData } = req.body;
    try {
        const match = qrData.match(/SCOUT_STATION_ID_(\d+)/);
        if (!match) return res.status(400).json({ success: false, message: "Invalid code format." });
        
        const stationNum = parseInt(match[1]);

        const { data: activeGame } = await supabase.from('games').select('stations_json').eq('is_active', true).single();
        if (!activeGame) return res.status(400).json({ success: false, message: "No game config active." });

        const targetStation = activeGame.stations_json.find(st => parseInt(st.PostNo) === stationNum);
        if (!targetStation) return res.status(404).json({ success: false, message: "Station missing from file setup." });

        const { data: existingLog } = await supabase.from('logs').select('*')
            .eq('team_id', teamId).eq('post_no', stationNum).eq('action_type', 'SCAN').maybeSingle();

        if (existingLog) {
            return res.json({ success: true, message: "Station previously logged!", station: targetStation });
        }

        await supabase.from('logs').insert([{
            team_id: teamId,
            post_no: stationNum,
            action_type: 'SCAN',
            details: `Scanned Checkpoint Station Post ${stationNum} at ${targetStation.PostLocation || 'Field Location'}`
        }]);

        // Guardrail safety path check if column scans_count doesn't exist yet
        try {
            const { data: teamData } = await supabase.from('teams').select('*').eq('team_id', teamId).single();
            if (teamData && 'scans_count' in teamData) {
                const currentCount = teamData.scans_count || 0;
                await supabase.from('teams').update({ scans_count: currentCount + 1 }).eq('team_id', teamId);
            }
        } catch(e) { /* suppress missing column errors safely */ }

        return res.json({ success: true, message: "New station scanned successfully!", station: targetStation });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/team/clue-log', async (req, res) => {
    const { teamId, postNo, clueIndex } = req.body;
    try {
        await supabase.from('logs').insert([{
            team_id: teamId,
            post_no: parseInt(postNo),
            action_type: 'CLUE',
            details: `Requested Clue Variant #${clueIndex} for Station Post ${postNo}`
        }]);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false });
    }
});

app.get('/api/team/logs/:teamId', async (req, res) => {
    const { teamId } = req.params;
    const { data } = await supabase.from('logs').select('*').eq('team_id', teamId).order('created_at', { ascending: false });
    return res.json({ success: true, logs: data || [] });
});

// --- LINEAR SEQUENTIAL INCREMENTING TEAM CREATION SYSTEM ---
app.post('/api/team/create', async (req, res) => {
    const { teamName, pin } = req.body;
    try {
        const normalizedName = String(teamName).trim();
        
        const { data: existingTeam } = await supabase.from('teams')
            .select('team_id')
            .eq('team_name', normalizedName)
            .maybeSingle();
            
        if (existingTeam) {
            return res.status(400).json({ success: false, message: "Team name already taken!" });
        }

        const { data: currentTeams } = await supabase.from('teams').select('team_id');
        let nextIndex = 1;
        if (currentTeams && currentTeams.length > 0) {
            const ids = currentTeams.map(t => parseInt(t.team_id)).filter(id => !isNaN(id));
            if (ids.length > 0) {
                nextIndex = Math.max(...ids) + 1;
            }
        }
        
        const calculatedId = String(nextIndex).padStart(3, '0');

        // Dynamic base insertion dictionary assignment avoiding manual strict column faults
        const rowData = { team_id: calculatedId, team_name: normalizedName, pin: String(pin).trim() };
        
        const { error } = await supabase.from('teams').insert([rowData]);
        if (error) throw error;
        
        return res.json({ success: true, teamId: calculatedId });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/team/rejoin', async (req, res) => {
    const { teamName, pin } = req.body;
    try {
        const { data: team } = await supabase.from('teams')
            .select('team_id', 'pin')
            .eq('team_name', String(teamName).trim())
            .maybeSingle();
            
        if (team && String(team.pin).trim() === String(pin).trim()) {
            return res.json({ success: true, teamId: team.team_id });
        }
        return res.status(401).json({ success: false, message: "Invalid team name or pin." });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Database query error." });
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