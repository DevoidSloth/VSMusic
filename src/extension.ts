import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as tmp from 'tmp';

interface MusicQuickPickItem extends vscode.QuickPickItem {
    url: string;
}

let currentSearchProcess: cp.ChildProcess | null = null;
let ffplayProcess: cp.ChildProcess | null = null;
let currentQuery = '';
let resultCount = 0;
let isPaused = false;
let currentVolume = 1.0; // Default volume (100%)

// Add this near the top of the file with other global variables
let currentPlaybackTime = 0;
let playbackInterval: NodeJS.Timeout | null = null;
let currentUrl: string | null = null;
let tempAudioFile: string | null = null;
let audioWriteStream: fs.WriteStream | null = null;
let pausedPosition: number = 0;

// Add these global variables
let isPlaying = false;
let currentPlaylist: MusicQuickPickItem[] = [];
let currentPlaylistIndex: number = -1;
let playlists: { [key: string]: MusicQuickPickItem[] } = {};
let currentPlaylistName: string | null = null;

export function activate(context: vscode.ExtensionContext) {
    console.log('YouTube Music Extension is now active!');

    findAndSetYtdlpPath();

    let searchDisposable = vscode.commands.registerCommand('extension.searchYouTubeMusic', async () => {
        const query = await vscode.window.showInputBox({
            prompt: 'Enter a music search query'
        });

        if (query) {
            currentQuery = query;
            resultCount = 0;
            const quickPick = vscode.window.createQuickPick<MusicQuickPickItem>();
            quickPick.placeholder = 'Select a music video';
            quickPick.busy = true;
            quickPick.show();

            searchYouTube(query, quickPick);

            quickPick.onDidAccept(async () => {
                const selected = quickPick.selectedItems[0];
                if (selected && selected.url) {
                    quickPick.hide();
                    await playAudio(selected.url);
                } else if (selected && selected.label === "Load More Results") {
                    searchYouTube(currentQuery, quickPick, true);
                }
            });
        }
    });

    let stopDisposable = vscode.commands.registerCommand('extension.stopYouTubeMusic', () => {
        stopAudio();
    });

    let pauseResumeDisposable = vscode.commands.registerCommand('extension.pauseResumeYouTubeMusic', () => {
        pauseResumeAudio();
    });

    let adjustVolumeDisposable = vscode.commands.registerCommand('extension.adjustYouTubeMusicVolume', () => {
        adjustVolume();
    });

    let addToPlaylistDisposable = vscode.commands.registerCommand('extension.addToYouTubeMusicPlaylist', addToPlaylist);
    let showPlaylistDisposable = vscode.commands.registerCommand('extension.showYouTubeMusicPlaylist', showPlaylist);
    let nextTrackDisposable = vscode.commands.registerCommand('extension.nextYouTubeMusicTrack', nextTrack);
    let previousTrackDisposable = vscode.commands.registerCommand('extension.previousYouTubeMusicTrack', previousTrack);
    let restartTrackDisposable = vscode.commands.registerCommand('extension.restartYouTubeMusicTrack', restartTrack);
    let createPlaylistDisposable = vscode.commands.registerCommand('extension.createYouTubeMusicPlaylist', createPlaylist);

    context.subscriptions.push(searchDisposable, stopDisposable, pauseResumeDisposable, adjustVolumeDisposable, addToPlaylistDisposable, showPlaylistDisposable, nextTrackDisposable, previousTrackDisposable, restartTrackDisposable, createPlaylistDisposable);
}

async function findAndSetYtdlpPath() {
    const config = vscode.workspace.getConfiguration('youtubeMusic');
    let ytdlpPath = config.get<string>('ytdlpPath');

    if (!ytdlpPath || !fs.existsSync(ytdlpPath)) {
        ytdlpPath = await findYtdlp();
        if (ytdlpPath) {
            await config.update('ytdlpPath', ytdlpPath, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`yt-dlp found and path set to: ${ytdlpPath}`);
        } else {
            vscode.window.showErrorMessage('yt-dlp not found. Please install it and set the path manually in settings.');
        }
    }
}

async function findYtdlp(): Promise<string | undefined> {
    const isWindows = os.platform() === 'win32';
    const executable = isWindows ? 'yt-dlp.exe' : 'yt-dlp';

    const searchPaths = [
        process.env.PATH,
        process.env.LOCALAPPDATA,
        process.env.APPDATA,
        process.env.HOME,
        '/usr/local/bin',
        '/usr/bin',
        'C:\\Program Files',
        'C:\\Program Files (x86)',
        'D:\\',
    ].filter(Boolean) as string[];

    for (const searchPath of searchPaths) {
        const fullPath = path.join(searchPath, executable);
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
    }

    try {
        const { stdout } = await execAsync(isWindows ? 'where yt-dlp' : 'which yt-dlp');
        return stdout.trim();
    } catch (error) {
        console.error('Error finding yt-dlp:', error);
    }

    return undefined;
}

function getYtdlpPath(): string {
    const config = vscode.workspace.getConfiguration('youtubeMusic');
    const configuredPath = config.get<string>('ytdlpPath');
    
    if (configuredPath && fs.existsSync(configuredPath)) {
        return configuredPath;
    }
    
    throw new Error('yt-dlp path not configured or invalid. Please set it in the extension settings.');
}

function searchYouTube(query: string, quickPick: vscode.QuickPick<MusicQuickPickItem>, getMore: boolean = false) {
    if (currentSearchProcess) {
        currentSearchProcess.kill();
    }

    const ytdlpPath = getYtdlpPath();
    const startIndex = getMore ? resultCount + 1 : 1;
    const searchLimit = getMore ? 5 : 1;
    const command = `"${ytdlpPath}" "ytsearch${searchLimit}:${query}" -O "%(title)s\t%(id)s\t%(duration)s\t%(view_count)s" --no-playlist --match-filter "!is_shorts"`;

    currentSearchProcess = cp.spawn(command, [], { shell: true });
    let buffer = '';
    let errorBuffer = '';

    currentSearchProcess.stdout?.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        const newItems: MusicQuickPickItem[] = [];
        for (const line of lines) {
            const [title, id, duration, viewCount] = line.split('\t');
            if (title && id) {
                resultCount++;
                newItems.push({
                    label: title,
                    description: `${formatDuration(parseInt(duration) || 0)} | Views: ${formatViews(parseInt(viewCount) || 0)}`,
                    url: `https://www.youtube.com/watch?v=${id}`
                });
            }
        }

        if (getMore) {
            quickPick.items = [...quickPick.items.filter(item => item.label !== "Load More Results"), ...newItems, createMoreResultsItem()];
        } else {
            quickPick.items = [...newItems, createMoreResultsItem()];
        }
    });

    currentSearchProcess.stderr?.on('data', (data) => {
        errorBuffer += data.toString();
    });

    currentSearchProcess.on('close', (code) => {
        quickPick.busy = false;
        if (code !== 0) {
            console.error(`Search process exited with code ${code}`);
            console.error('Error output:', errorBuffer);
            vscode.window.showErrorMessage(`Search failed. Error: ${errorBuffer}`);
        }
    });
}

function createMoreResultsItem(): MusicQuickPickItem {
    return {
        label: "Load More Results",
        description: "",
        url: ""
    };
}

async function playAudio(url: string, startTime: number = 0): Promise<void> {
    if (ffplayProcess) {
        ffplayProcess.kill();
        ffplayProcess = null;
    }

    console.log(`Playing audio from URL: ${url}, starting at ${startTime} seconds`);

    currentUrl = url;
    currentPlaybackTime = startTime;
    isPaused = false;
    isPlaying = true;

    const ytdlpPath = getYtdlpPath();
    console.log(`Using yt-dlp path: ${ytdlpPath}`);

    const ytdlpProcess = cp.spawn(ytdlpPath, ['-o', '-', '-f', 'bestaudio', url]);
    console.log('yt-dlp process spawned');

    ffplayProcess = cp.spawn('ffplay', [
        '-nodisp',
        '-autoexit',
        '-i', 'pipe:0',
        '-ss', startTime.toString(),
        '-volume', `${Math.round(currentVolume * 100)}`,
        '-loglevel', 'info',
        '-stats',
        '-vn',
        '-window_title', 'VSCode YouTube Music'
    ]);
    console.log('ffplay process spawned');

    if (ytdlpProcess.stdout && ffplayProcess.stdin) {
        ytdlpProcess.stdout.pipe(ffplayProcess.stdin);
        console.log('yt-dlp output piped to ffplay');
    } else {
        console.error('Failed to pipe yt-dlp output to ffplay');
    }

    ytdlpProcess.stderr?.on('data', (data) => {
        console.error('yt-dlp error:', data.toString());
    });

    ffplayProcess.stderr?.on('data', (data) => {
        console.log('ffplay output:', data.toString());
    });

    ffplayProcess.on('close', (code) => {
        console.log(`ffplay process exited with code ${code}`);
        isPlaying = false;
        if (!isPaused) {
            playNextTrack();
        }
    });

    vscode.window.showInformationMessage('Audio playback started');
}

function playNextTrack() {
    if (currentPlaylist.length === 0) {
        return;
    }

    currentPlaylistIndex++;
    if (currentPlaylistIndex >= currentPlaylist.length) {
        currentPlaylistIndex = 0; // Loop back to the beginning
    }

    const nextTrack = currentPlaylist[currentPlaylistIndex];
    playAudio(nextTrack.url);
    vscode.window.showInformationMessage(`Now playing: ${nextTrack.label}`);
}

function pauseResumeAudio() {
    if (!currentUrl) {
        vscode.window.showInformationMessage('No audio is currently playing');
        return;
    }

    if (isPaused) {
        // Resume playback
        console.log('Resuming playback from:', pausedPosition);
        playAudio(currentUrl, pausedPosition);
        isPaused = false;
        vscode.window.showInformationMessage('Audio playback resumed');
    } else {
        // Pause playback
        if (ffplayProcess && isPlaying) {
            console.log('Pausing playback at:', currentPlaybackTime);
            ffplayProcess.kill('SIGSTOP');
            pausedPosition = currentPlaybackTime;
            isPaused = true;
            isPlaying = false;
            vscode.window.showInformationMessage('Audio playback paused');
        }
    }
}

function stopAudio() {
    if (ffplayProcess) {
        ffplayProcess.kill();
        ffplayProcess = null;
    }
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
    currentUrl = null;
    currentPlaybackTime = 0;
    pausedPosition = 0;
    isPaused = false;
    isPlaying = false;
    currentPlaylistIndex = -1; // Reset playlist index when stopping
}

async function adjustVolume() {
    const volumeInput = await vscode.window.showInputBox({
        prompt: 'Enter volume (0-100)',
        validateInput: (value) => {
            const num = Number(value);
            return (num >= 0 && num <= 100) ? null : 'Please enter a number between 0 and 100';
        }
    });

    if (volumeInput) {
        currentVolume = Number(volumeInput) / 100;
        if (ffplayProcess) {
            stopAudio();
            if (ffplayProcess) {
                ffplayProcess.stdin?.write(`v ${Math.round(currentVolume * 100)}\n`);
                vscode.window.showInformationMessage(`Volume set to ${Math.round(currentVolume * 100)}%`);
            }
        } else {
            vscode.window.showInformationMessage(`Volume will be set to ${Math.round(currentVolume * 100)}% for the next playback`);
        }
    }
}

function formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatViews(views: number): string {
    if (views >= 1000000) {
        return `${(views / 1000000).toFixed(1)}M`;
    } else if (views >= 1000) {
        return `${(views / 1000).toFixed(1)}K`;
    } else {
        return views.toString();
    }
}

function execAsync(command: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        cp.exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

async function addToPlaylist() {
    if (Object.keys(playlists).length === 0) {
        vscode.window.showInformationMessage('No playlists available. Create a playlist first.');
        return;
    }

    const playlistNames = Object.keys(playlists);
    const selectedPlaylist = await vscode.window.showQuickPick(playlistNames, {
        placeHolder: 'Select a playlist to add to'
    });

    if (!selectedPlaylist) {
        return;
    }

    const query = await vscode.window.showInputBox({
        prompt: `Enter a music search query to add to "${selectedPlaylist}"`
    });

    if (query) {
        const quickPick = vscode.window.createQuickPick<MusicQuickPickItem>();
        quickPick.placeholder = 'Select a music video to add to the playlist';
        quickPick.busy = true;
        quickPick.show();

        searchYouTube(query, quickPick);

        quickPick.onDidAccept(async () => {
            const selected = quickPick.selectedItems[0];
            if (selected && selected.url) {
                playlists[selectedPlaylist].push(selected);
                quickPick.hide();
                vscode.window.showInformationMessage(`Added "${selected.label}" to the playlist "${selectedPlaylist}"`);
            }
        });
    }
}

async function showPlaylist() {
    if (Object.keys(playlists).length === 0) {
        vscode.window.showInformationMessage('No playlists available. Create a playlist first.');
        return;
    }

    const playlistNames = Object.keys(playlists);
    const selectedPlaylist = await vscode.window.showQuickPick(playlistNames, {
        placeHolder: 'Select a playlist to view'
    });

    if (selectedPlaylist) {
        currentPlaylistName = selectedPlaylist;
        currentPlaylist = playlists[selectedPlaylist];
        currentPlaylistIndex = -1;

        if (currentPlaylist.length === 0) {
            vscode.window.showInformationMessage(`The playlist "${selectedPlaylist}" is empty`);
            return;
        }

        const quickPick = vscode.window.createQuickPick<MusicQuickPickItem>();
        quickPick.items = currentPlaylist;
        quickPick.placeholder = 'Select a track to play';
        quickPick.show();

        quickPick.onDidAccept(async () => {
            const selected = quickPick.selectedItems[0];
            if (selected && selected.url) {
                currentPlaylistIndex = currentPlaylist.findIndex(item => item.url === selected.url);
                quickPick.hide();
                await playAudio(selected.url);
            }
        });
    }
}

async function nextTrack() {
    if (currentPlaylist.length === 0) {
        vscode.window.showInformationMessage('No playlist is currently active');
        return;
    }

    playNextTrack();
}

async function previousTrack() {
    if (currentPlaylist.length === 0) {
        vscode.window.showInformationMessage('No playlist is currently active');
        return;
    }

    currentPlaylistIndex--;
    if (currentPlaylistIndex < 0) {
        currentPlaylistIndex = currentPlaylist.length - 1; // Loop to the end
    }

    const prevTrack = currentPlaylist[currentPlaylistIndex];
    await playAudio(prevTrack.url);
    vscode.window.showInformationMessage(`Now playing: ${prevTrack.label}`);
}

async function restartTrack() {
    if (currentUrl) {
        await playAudio(currentUrl, 0);
        vscode.window.showInformationMessage('Restarting current track');
    } else {
        vscode.window.showInformationMessage('No track is currently playing');
    }
}

async function createPlaylist() {
    const playlistName = await vscode.window.showInputBox({
        prompt: 'Enter a name for the new playlist'
    });

    if (playlistName) {
        if (playlists[playlistName]) {
            vscode.window.showErrorMessage(`A playlist named "${playlistName}" already exists.`);
        } else {
            playlists[playlistName] = [];
            currentPlaylistName = playlistName;
            currentPlaylist = playlists[playlistName];
            currentPlaylistIndex = -1;
            vscode.window.showInformationMessage(`Playlist "${playlistName}" created and set as current playlist.`);
        }
    }
}

export function deactivate() {
    stopAudio();
    if (currentSearchProcess) {
        currentSearchProcess.kill();
    }
}