const { MongoClient, GridFSBucket } = require('mongodb');

// Connection URL
const url = 'mongodb://127.0.0.1:27017/';
const client = new MongoClient(url);

// Database Name
const dbName = 'test'; // Changed to 'test'

// Define license key limits
const licenseKeyLimits = {
    "BurnsideHighSchool": 4,
    "MP003": 8,
    "3399": 20,
    "STUDENT_KEY_1": 10,
    "TEACHER_KEY_2": 10,
    // Add more license keys and their limits as needed
};

// Define license keys for account types
const validLicenseKeys = {
    student: ["STUDENT_KEY_1", "STUDENT_KEY_2"], // Replace with actual student license keys
    teacher: ["TEACHER_KEY_1", "TEACHER_KEY_2"]  // Replace with actual teacher license keys
};

async function connectToDatabase() {
    try {
        // Connect the client to the server
        await client.connect();
        console.log('Connected successfully to MongoDB server');

        // Access the database
        const db = client.db(dbName);
        console.log(`Database "${dbName}" is ready for use`);

        return db;
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
    }
}

async function createUser(userData) {
    const db = client.db(dbName);
    const usersCollection = db.collection('users');

    // Check if the email already exists
    console.log("Checking for existing user with email:", userData.email);
    const existingUser = await usersCollection.findOne({ email: userData.email });
    console.log("Existing user found:", existingUser ? existingUser.email : "No user found");
    if (existingUser) {
        throw new Error('Email already in use');
    }

    // Check if the license key is valid for the account type
    if (!validLicenseKeys[userData.accountType].includes(userData.licenseKey)) {
        throw new Error('Invalid license key for the selected account type.');
    }

    // Check the registered count for the license key
    const licenseKeyCount = await usersCollection.countDocuments({ licenseKey: userData.licenseKey });
    const licenseKeyLimit = licenseKeyLimits[userData.licenseKey] || 0; // Get the limit for the license key

    console.log(`License key: ${userData.licenseKey}, Registered count: ${licenseKeyCount}, Limit: ${licenseKeyLimit}`);

    if (licenseKeyCount >= licenseKeyLimit) {
        throw new Error('License key limit reached. No more accounts can be registered with this key.');
    }
    
    // Insert the new user
    console.log("User data being inserted:", userData);
    try {
        const result = await usersCollection.insertOne(userData);
        console.log("Insert result:", result); // Log the entire result object
        if (result && result.insertedId) {
            console.log("User successfully registered:", userData); // Log the created user
            return userData; // Return the created user
        } else {
            throw new Error('Failed to retrieve inserted user data');
        }
    } catch (error) {
        console.log("User data being inserted:", userData);
        console.error("Error during user registration:", error); // Log the error
        throw new Error('Failed to register user');
    }
}

async function readUser(email) {
    const db = client.db(dbName);
    const usersCollection = db.collection('users');

    // Find the user by email
    const user = await usersCollection.findOne({ email: email });
    if (!user) {
        throw new Error('User not found');
    }

    // Fetch the user's videos
    const videosCollection = db.collection('videos');
    const videos = await videosCollection.find({ userId: user._id }).toArray();

    return { user, videos }; // Return user details and their videos
}

async function updateUser(email, updateData) {
    const db = client.db(dbName);
    const usersCollection = db.collection('users');

    // Update the user information
    const result = await usersCollection.updateOne(
        { email: email },
        { $set: updateData }
    );

    if (result.modifiedCount === 0) {
        throw new Error('User not found or no changes made');
    }

    return result;
}

async function deleteUser(email) {
    const db = client.db(dbName);
    const usersCollection = db.collection('users');

    // Delete the user
    const result = await usersCollection.deleteOne({ email: email });
    if (result.deletedCount === 0) {
        throw new Error('User not found');
    }

    // Optionally, delete the user's videos
    const videosCollection = db.collection('videos');
    await videosCollection.deleteMany({ userId: result._id });

    return result;
}

async function uploadVideo(videoData) {
    try {
        console.log('Connecting to database for video upload...');
        const db = client.db(dbName);
        if (!db) {
            throw new Error('Database connection failed');
        }

        // Create GridFS bucket
        const bucket = new GridFSBucket(db, {
            bucketName: 'videos'
        });

        // Create readable stream from buffer
        const readableVideoStream = require('stream').Readable.from(videoData.buffer);
        
        console.log('Video MIME type:', videoData.mimetype); // Log the MIME type
        const uploadStream = bucket.openUploadStream(videoData._id, {
            metadata: {
                title: videoData.title,
                subject: videoData.subject,
                userId: videoData.userId,
                userEmail: videoData.userEmail,
                classCode: videoData.classCode,
                contentType: videoData.mimetype,
                viewed: false, // New field to track if the video has been viewed
            }
        });

        // Pipe the video data to GridFS
        return new Promise((resolve, reject) => {
            readableVideoStream.pipe(uploadStream)
                .on('error', (error) => {
                    console.error('Error during upload stream:', error);
                    console.error('Error uploading video to GridFS:', error);
                    reject(new Error('Failed to upload video: ' + error.message));
                })
                .on('finish', () => {
                    console.log('Upload stream finished, video should be stored in GridFS. File ID:', uploadStream.id);
                    console.log('Video metadata:', uploadStream.options.metadata); // Log the metadata for verification
                    console.log('Video uploaded successfully to GridFS, checking for chunks...');
                    resolve({
                        fileId: uploadStream.id,
                        filename: uploadStream.filename,
                        metadata: uploadStream.options.metadata
                    });
                });
        });
    } catch (error) {
        console.error('Error uploading video:', error);
        throw new Error('Failed to upload video: ' + error.message);
    }
}

module.exports = { connectToDatabase, createUser, readUser, updateUser, deleteUser, uploadVideo };
