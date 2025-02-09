require('dotenv').config(); // Load environment variables
const express = require('express');
const { 
    sendPasswordResetEmail, 
    generateResetToken, 
    storeResetToken, 
    validateResetToken, 
    deleteResetToken 
} = require('./emailService');
const multer = require('multer');

const { connectToDatabase, uploadVideo, createUser } = require('./db');
const path = require('path');
const cors = require('cors'); // Import CORS middleware

const app = express();
const port = 3000;

const bcrypt = require('bcrypt'); // Import bcrypt for password hashing
const { MongoClient, ObjectId } = require('mongodb'); // Import MongoDB client
const mongodb = require('mongodb'); // Import mongodb module for GridFS

// Predefined valid license keys
const validLicenseKeys = ["BurnsideHighSchool", "MP003", "3399", "STUDENT_KEY_1", "TEACHER_KEY_2"]; // Add more keys as needed

// MongoDB connection setup
const uri = 'mongodb://127.0.0.1:27017/test'; // Connect to the test database
const client = new MongoClient(uri);
let db;

// Middleware for parsing application/json
app.use(express.json());

app.use(cors()); // Enable CORS for all routes
// Configure multer to handle in-memory file storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 * 1024, // 5GB limit
        fieldSize: 5 * 1024 * 1024 * 1024 // 5GB limit for fields
    },
    fileFilter: (req, file, cb) => {
        // Accept video files only
        if (file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Only video files are allowed'), false);
        }
    }
});

// Video upload endpoint
app.get('/user-info', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const db = await connectToDatabase();
        const user = await db.collection('users').findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({
            classCode: user.classCode,
            firstName: user.firstName
        });
    } catch (error) {
        console.error('Error fetching user info:', error);
        res.status(500).json({ message: 'Failed to fetch user info' });
    }
});

app.post('/upload', upload.single('video'), async (req, res) => {
    console.log('Upload request received');
    console.log('Request body:', req.body);
    console.log('Uploaded file:', req.file);

    if (!req.file) {
        console.log('No file uploaded');
        return res.status(400).json({ message: 'No video file uploaded' });
    }

    try {
        console.log('Connecting to database...');
        const db = await connectToDatabase();
        const usersCollection = db.collection('users');
        
        console.log('Looking up user:', req.body.email);
        const user = await usersCollection.findOne({ email: req.body.email });
        if (!user) {
            console.log('User not found');
            return res.status(404).json({ message: 'User not found' });
        }

        const videoData = {
            title: req.body.title,
            subject: req.body.subject,
            userId: user._id.toString(), // Ensure userId is stored as a string
            userEmail: user.email,
            classCode: user.classCode,
            accountType: user.accountType,
            buffer: req.file.buffer,
            filename: `${Date.now()}_${req.file.originalname}`,
            mimetype: req.file.mimetype,
            studentName: user.firstName
        };
        console.log('Video data:', videoData);

        console.log('Uploading video to database...');
        const video = await uploadVideo(videoData);
        console.log('Video uploaded successfully:', video);

        res.status(201).json({
            message: 'Video uploaded successfully',
            video: {
                id: video.fileId,
                title: video.metadata.title,
                filename: video.filename
            }
        });
    } catch (error) {
        console.error('Video upload error:', error);
        res.status(500).json({ 
            message: 'Failed to upload video',
            error: error.message 
        });
    }
});

app.use(express.static(__dirname)); // Serve static files from the current directory

app.post('/register', async (req, res) => {
    console.log("Registration request received:", req.body); // Log the request body
    console.log("Valid license keys:", validLicenseKeys); // Log the valid license keys
    const { licenseKey } = req.body; // Assuming the license key is sent in the request body
    console.log("License key received:", licenseKey); // Log the received license key

    if (validLicenseKeys.includes(licenseKey)) {
        const { firstName, email, password, classCode, accountType } = req.body; // Get user details from request body
        console.log("Password received:", password); // Log the received password
        const hashedPassword = await bcrypt.hash(password, 10); // Hash the password

        const db = await connectToDatabase();
        const usersCollection = db.collection('users');

        console.log("Checking for existing user with email:", email); // Log the email being checked
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "Email already in use." });
        }

        // Create a new user object
        const newUser = {
            firstName,
            email,
            password: hashedPassword,
            classCode,
            licenseKey, // Store the license key for the user
            accountType // Store the account type for the user
        };

        // Use the createUser function to insert the new user into the database
        try {
            await createUser(newUser);
            res.status(200).json({ message: "Registration successful!", email }); // Successful registration with email
        } catch (error) {
            console.error("Error during user registration:", error.message);
            res.status(400).json({ message: error.message }); // Return the error message
        }
    } else {
        res.status(400).json({ message: "Invalid license key" });
    }
});

app.post('/sign-in', async (req, res) => {
    const { email, password } = req.body; // Get user credentials from request body
    console.log("Sign-in request received:", req.body); // Log the request body

    try {
        const db = await connectToDatabase();
        const usersCollection = db.collection('users');

        // Find the user by email
        const user = await usersCollection.findOne({ email: email });
        if (!user) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        // Compare the provided password with the stored hashed password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        // Successful sign-in
        const redirectPage = user.accountType === 'teacher' ? 'teacher-.html' : 'student-.html';
        res.status(200).json({ message: "Sign-in successful!", redirectPage, user: { email: user.email, firstName: user.firstName, accountType: user.accountType } });
    } catch (error) {
        console.error("Error during sign-in:", error);
        res.status(500).json({ message: "Internal server error." });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'sign-in.html')); // Serve sign-in.html
});

app.get('/videos.files/:id', async (req, res) => {
    console.log('Attempting to retrieve video from GridFS with ID:', req.params.id);
    try {
        const db = await connectToDatabase();
        const bucket = new mongodb.GridFSBucket(db, {bucketName: 'videos'});
        
        const videoId = new mongodb.ObjectId(req.params.id);
        const chunks = await db.collection('videos.chunks').find({ files_id: videoId }).toArray();
        console.log('Chunks found for video ID:', chunks.length); // Log the number of chunks found

        if (chunks.length === 0) {
            console.error('No chunks found for video ID:', req.params.id);
            return res.status(404).json({ message: 'Video chunks not found' });
        }
        const videoFile = await db.collection('videos.files').findOne({ _id: videoId });
        if (!videoFile) {
            console.error('Video not found in database:', req.params.id);
            return res.status(404).json({ message: 'Video not found' });
        }
        const downloadStream = bucket.openDownloadStream(videoId);
        console.log('Opening download stream for video ID:', videoId.toString()); // Log the ID being used for streaming
        downloadStream.on('error', (error) => {
            console.error('Error downloading video:', error);
            res.status(404).json({ message: 'Video not found' });
        });

        res.set('Content-Type', videoFile.metadata.contentType || 'video/mp4'); // Set the correct Content-Type
        downloadStream.pipe(res);
    } catch (error) {
        console.error('Error testing video:', error);
        res.status(500).json({ message: 'Failed to test video' });
    }
});

app.get('/videos.chunks/:id', async (req, res) => {
    try {
        const db = await connectToDatabase();
        const bucket = new mongodb.GridFSBucket(db);
        
        const videoId = new mongodb.ObjectId(req.params.id);
        const chunks = await db.collection('videos.chunks').find({ files_id: videoId }).toArray();
        res.status(200).json(chunks);
    } catch (error) {
        console.error('Error listing video chunks:', error);
        res.status(500).json({ message: 'Failed to list video chunks' });
    }
});
    
app.get('/videos', async (req, res) => {
    try {
        const db = await connectToDatabase();
        const bucket = new mongodb.GridFSBucket(db, {bucketName: 'videos'});
        
        const email = req.query.email;
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }
        
        // Find user to get their ID
        const usersCollection = db.collection('users');
        console.log('Received email for video fetch:', email); // Log the received email
        const user = await usersCollection.findOne({ email });
        console.log('User found:', user); // Log the user found
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        // Find videos based on account type
        let videos = [];
        
        if (user.accountType === 'teacher') {
            // For teachers, get all videos from their school
            console.log('Fetching videos for teacher:', user.email);
            const query = { 'metadata.userId': { $exists: true }, 'metadata.classCode': user.classCode };
            console.log('Teacher query:', query);
            
            // Query GridFS files collection
            videos = await db.collection('videos.files')
                .find({ 'metadata.classCode': user.classCode })
                .toArray();
        } else {
            // For students, get only their own videos
            console.log('Fetching videos for student:', user.email);
            const query = { 
                'metadata.userEmail': user.email
            };
            console.log('Student query:', query);
            
            // Query GridFS files collection
            videos = await db.collection('videos.files')
                .find(query)
                .toArray();
        }
        
        console.log('Found videos:', videos.length);
        console.log('Video details:', videos);
            
        res.status(200).json(videos);
    } catch (error) {
        console.error('Error fetching videos:', error);
        res.status(500).json({ message: 'Failed to fetch videos' });
    }
});

app.delete('/delete-video', async (req, res) => {
    const videoId = req.query.id; // Get the video ID from the query parameter
    console.log('Delete request received for video ID:', videoId); // Log the video ID

    if (!videoId) {
        return res.status(400).json({ message: 'Video ID is required' });
    }

    try {
        const db = await connectToDatabase();
        const videoResult = await db.collection('videos.files').deleteOne({ _id: new ObjectId(videoId) });
        
        // Delete associated video chunks
        const chunksResult = await db.collection('videos.chunks').deleteMany({ files_id: new ObjectId(videoId) });

        if (videoResult.deletedCount === 0) {
            console.error('No video found with ID:', videoId);
            return res.status(404).json({ message: 'Video not found' });
        }

        console.log('Video deleted successfully:', videoId);
        res.status(200).json({ message: 'Video deleted successfully' });
    } catch (error) {
        console.error('Error deleting video:', error);
        res.status(500).json({ message: 'Failed to delete video' });
    }
});

app.post('/videos/view', async (req, res) => {
    const videoId = req.body.id; // Get the video ID from the request body
    console.log('Mark as viewed request received for video ID:', videoId); // Log the video ID

    if (!videoId) {
        return res.status(400).json({ message: 'Video ID is required' });
    }

    try {
        const db = await connectToDatabase();
        const result = await db.collection('videos.files').updateOne(
            { _id: new ObjectId(videoId) },
            { $set: { 'metadata.viewed': true } } // Update the viewed status
        );

        if (result.modifiedCount === 0) {
            console.error('No video found with ID:', videoId);
            return res.status(404).json({ message: 'Video not found or already viewed' });
        }

        console.log('Video marked as viewed successfully:', videoId);
        res.status(200).json({ message: 'Video marked as viewed successfully' });
    } catch (error) {
        console.error('Error marking video as viewed:', error);
        res.status(500).json({ message: 'Failed to mark video as viewed' });
    }
});

// Password Reset Request Endpoint
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;

    try {
        const db = await connectToDatabase();
        const usersCollection = db.collection('users');
        
        // Check if the email exists in the database
        const user = await usersCollection.findOne({ email });
        
        // For security, don't reveal if email exists or not
        if (!user) {
            // Still return success to prevent email enumeration
            return res.status(200).send('If your email exists in our system, you will receive a password reset link.');
        }

        // Generate and store reset token
        const token = generateResetToken();
        storeResetToken(email, token);

        // Log the reset link (for development/testing)
        console.log('Password reset link:', `http://localhost:3000/reset-password.html?token=${token}`);

        // In production, this would send an actual email
        await sendPasswordResetEmail(email, token);

        res.status(200).send('If your email exists in our system, you will receive a password reset link.');
    } catch (error) {
        console.error('Error processing password reset request:', error);
        // Generic error message for security
        return res.status(500).send('An error occurred. Please try again later.');
    }
});

// Password Reset Endpoint
app.post('/api/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;

    try {
        // Validate the reset token
        const email = validateResetToken(token);
        if (!email) {
            return res.status(400).send('This password reset link has expired or is invalid. Please request a new one.');
        }

        const db = await connectToDatabase();
        const usersCollection = db.collection('users');

        // Hash the new password and update it in the database
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const result = await usersCollection.updateOne(
            { email }, 
            { $set: { password: hashedPassword } }
        );

        if (result.modifiedCount === 0) {
            return res.status(400).send('Unable to update password. Please try again.');
        }

        // Delete the used token
        deleteResetToken(token);

        res.status(200).send('Your password has been reset successfully. You can now log in with your new password.');
    } catch (error) {
        console.error('Error resetting password:', error);
        return res.status(500).send('An error occurred while resetting your password. Please try again.');
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
