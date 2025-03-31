// Constants for storage
const DIRECTORY_HANDLE_KEY = 'video-directory-handle';

// Main class to handle file system access and video streaming
class FileSystemHandler {
  constructor() {
    this.directoryHandle = null;
    this.videoFileHandles = [];
    this.videoElement = document.getElementById('video-player');
  }

  // Initialize the file system handler
  async initialize() {
    try {
      // Try to get existing permissions first
      await this.loadSavedDirectoryHandle();
      
      // If we don't have a directory handle or permissions are not granted, request access
      if (!this.directoryHandle) {
        await this.requestDirectoryAccess();
      }
      
      // Scan for video files
      await this.scanForVideoFiles();
      
      // Update the UI with available videos
      this.updateVideoList();
    } catch (error) {
      console.error('Initialization error:', error);
      document.getElementById('status').textContent = `Error: ${error.message}`;
    }
  }

  // Request directory access from the user
  async requestDirectoryAccess() {
    try {
      // Show directory picker to the user
      this.directoryHandle = await window.showDirectoryPicker({
        id: 'videos-directory',
        mode: 'read',
        startIn: 'videos'
      });
      
      // Save the directory handle for future use
      await this.saveDirectoryHandle();
      
      document.getElementById('status').textContent = 'Directory access granted';
    } catch (error) {
      console.error('Error requesting directory access:', error);
      document.getElementById('status').textContent = 'Failed to get directory access';
      throw error;
    }
  }

  // Save the directory handle to IndexedDB for persistence
  async saveDirectoryHandle() {
    if (this.directoryHandle) {
      localStorage.setItem(DIRECTORY_HANDLE_KEY, JSON.stringify({
        stored: true,
        timestamp: Date.now()
      }));
      
      // Store the actual handle in IDB
      const db = await this.openDatabase();
      const transaction = db.transaction(['handles'], 'readwrite');
      const store = transaction.objectStore('handles');
      await store.put(this.directoryHandle, DIRECTORY_HANDLE_KEY);
      
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }
  }

  // Load a previously saved directory handle
  async loadSavedDirectoryHandle() {
    // Check if we have a saved handle
    const handleInfo = localStorage.getItem(DIRECTORY_HANDLE_KEY);
    
    if (!handleInfo) {
      return false;
    }
    
    try {
      // Open the database and retrieve the handle
      const db = await this.openDatabase();
      const transaction = db.transaction(['handles'], 'readonly');
      const store = transaction.objectStore('handles');
      this.directoryHandle = await store.get(DIRECTORY_HANDLE_KEY);
      
      // Verify we still have permission
      const permissionState = await this.directoryHandle.queryPermission({ mode: 'read' });
      
      if (permissionState === 'granted') {
        document.getElementById('status').textContent = 'Using saved directory access';
        return true;
      } else if (permissionState === 'prompt') {
        // Request permission again
        const newPermission = await this.directoryHandle.requestPermission({ mode: 'read' });
        if (newPermission === 'granted') {
          document.getElementById('status').textContent = 'Permission re-granted';
          return true;
        }
      }
      
      // If we reached here, we don't have permission
      this.directoryHandle = null;
      return false;
    } catch (error) {
      console.error('Error loading saved handle:', error);
      this.directoryHandle = null;
      return false;
    }
  }

  // Open the IndexedDB database for handle storage
  openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('FileSystemHandles', 1);
      
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles');
        }
      };
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Scan the directory for video files
  async scanForVideoFiles() {
    if (!this.directoryHandle) {
      throw new Error('No directory handle available');
    }
    
    this.videoFileHandles = [];
    
    // Process all entries in the directory
    for await (const entry of this.directoryHandle.values()) {
      if (entry.kind === 'file' && this.isVideoFile(entry.name)) {
        this.videoFileHandles.push(entry);
      }
    }
    
    document.getElementById('status').textContent = `Found ${this.videoFileHandles.length} video files`;
  }

  // Check if a file is a video based on its extension
  isVideoFile(filename) {
    const videoExtensions = ['.m4b', '.mp3','.mp4', '.webm', '.ogg', '.mov', '.mkv'];
    return videoExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  }

  // Update the UI with the list of available videos
  updateVideoList() {
    const videoList = document.getElementById('video-list');
    videoList.innerHTML = '';
    
    this.videoFileHandles.forEach((fileHandle, index) => {
      const listItem = document.createElement('li');
      listItem.textContent = fileHandle.name;
      listItem.addEventListener('click', () => this.streamVideo(index));
      videoList.appendChild(listItem);
    });
  }

  // Stream a video file efficiently
  async streamVideo(index) {
    if (index < 0 || index >= this.videoFileHandles.length) {
      throw new Error('Invalid video index');
    }
    
    try {
      const fileHandle = this.videoFileHandles[index];
      document.getElementById('status').textContent = `Loading: ${fileHandle.name}`;
      
      // Get the file
      const file = await fileHandle.getFile();
      
      // Create a URL for the file
      const videoUrl = URL.createObjectURL(file);
      
      // Set up the video player
      this.videoElement.src = videoUrl;
      this.videoElement.onloadedmetadata = () => {
        document.getElementById('status').textContent = `Playing: ${fileHandle.name}`;
        this.videoElement.play().catch(error => {
          console.error('Error playing video:', error);
        });
      };
      
      // Make sure to revoke the URL when no longer needed
      this.videoElement.onended = () => {
        URL.revokeObjectURL(videoUrl);
        document.getElementById('status').textContent = 'Playback ended';
      };
    } catch (error) {
      console.error('Error streaming video:', error);
      document.getElementById('status').textContent = `Error: ${error.message}`;
    }
  }

  // For larger files, use a more efficient streaming approach with ReadableStream
  async streamLargeVideo(index) {
    if (index < 0 || index >= this.videoFileHandles.length) {
      throw new Error('Invalid video index');
    }
    
    try {
      const fileHandle = this.videoFileHandles[index];
      document.getElementById('status').textContent = `Loading large video: ${fileHandle.name}`;
      
      // Get the file
      const file = await fileHandle.getFile();
      
      // Create a media source
      const mediaSource = new MediaSource();
      this.videoElement.src = URL.createObjectURL(mediaSource);
      
      mediaSource.addEventListener('sourceopen', async () => {
        // Create a source buffer
        const mimeCodec = this.getMimeCodec(fileHandle.name);
        if (!MediaSource.isTypeSupported(mimeCodec)) {
          console.error('Unsupported MIME type or codec:', mimeCodec);
          document.getElementById('status').textContent = 'Unsupported video format';
          return;
        }
        
        const sourceBuffer = mediaSource.addSourceBuffer(mimeCodec);
        
        // Read the file in chunks
        const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
        let offset = 0;
        
        while (offset < file.size) {
          const chunk = await this.readChunk(file, offset, CHUNK_SIZE);
          
          // Wait if the buffer is updating
          if (sourceBuffer.updating) {
            await new Promise(resolve => {
              sourceBuffer.addEventListener('updateend', resolve, { once: true });
            });
          }
          
          // Append the chunk to the source buffer
          sourceBuffer.appendBuffer(chunk);
          
          // Wait for the update to complete
          await new Promise(resolve => {
            sourceBuffer.addEventListener('updateend', resolve, { once: true });
          });
          
          offset += CHUNK_SIZE;
          document.getElementById('status').textContent = `Loading: ${Math.floor((offset / file.size) * 100)}%`;
        }
        
        // Close the media source when done
        mediaSource.endOfStream();
        document.getElementById('status').textContent = `Playing: ${fileHandle.name}`;
      });
    } catch (error) {
      console.error('Error streaming large video:', error);
      document.getElementById('status').textContent = `Error: ${error.message}`;
    }
  }

  // Read a chunk of data from a file
  async readChunk(file, offset, length) {
    const slice = file.slice(offset, offset + length);
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(new Uint8Array(e.target.result));
      reader.readAsArrayBuffer(slice);
    });
  }

  // Get the MIME type and codec based on file extension
  getMimeCodec(filename) {
    const extension = filename.toLowerCase().split('.').pop();
    
    const mimeTypes = {
      'm4b': 'audio/mp4; codecs="mp4a.40.2"', 
      'mp3': 'audio/mpeg; codecs="mp3"', 
      'mp4': 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
      'webm': 'video/webm; codecs="vp8, vorbis"',
      'ogg': 'video/ogg; codecs="theora, vorbis"',
      'mov': 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
      'mkv': 'video/webm; codecs="vp8, vorbis"'
    };
    
    return mimeTypes[extension] || 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
  }
}

// HTML structure is required
// <div id="app">
//   <h1>PWA Video Player</h1>
//   <div id="status">Initializing...</div>
//   <video id="video-player" controls></video>
//   <h2>Available Videos</h2>
//   <ul id="video-list"></ul>
//   <button id="directory-button">Select Directory</button>
// </div>

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const fileSystemHandler = new FileSystemHandler();
  
  // Initialize the file system handler
  fileSystemHandler.initialize().catch(error => {
    console.error('Initialization error:', error);
  });
  
  // Add event listener for the select directory button
  document.getElementById('directory-button').addEventListener('click', () => {
    fileSystemHandler.requestDirectoryAccess()
      .then(() => fileSystemHandler.scanForVideoFiles())
      .then(() => fileSystemHandler.updateVideoList())
      .catch(error => {
        console.error('Directory access error:', error);
      });
  });
});