/**
 * Module handles database management
 *
 * Server API calls the methods in here to query and update the SQLite database
 */

// Utilities we need
const fs = require("fs");
const bcrypt = require("bcryptjs");

// Initialize the database
const dbFile = "./.data/choices.db";
const exists = fs.existsSync(dbFile);

console.log('Initializing database...');

// Close the database connection and delete the database file if it exists
const sqlite3 = require("sqlite3").verbose();
const dbWrapper = require("sqlite");
let db;

async function initializeDatabase() {
  /* 
  We're using the sqlite wrapper so that we can make async / await connections
  - https://www.npmjs.com/package/sqlite
  */
  dbWrapper
    .open({
      filename: dbFile,
      driver: sqlite3.Database
    })
    .then(async dBase => {
      db = dBase;

      // We use try and catch blocks throughout to handle any database errors
      try {
        // Check if the users table exists
        const usersTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");

        if (!usersTableExists) {
          console.log('Users table does not exist, creating tables...');

          // Check if the Choices table exists
          const choicesTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='Choices'");
          if (!choicesTableExists) {
            // Database doesn't exist yet - create Choices and Log tables
            await db.run(
              "CREATE TABLE Choices (id INTEGER PRIMARY KEY AUTOINCREMENT, language TEXT, picks INTEGER)"
            );

            // Add default choices to table
            await db.run(
              "INSERT INTO Choices (language, picks) VALUES ('HTML', 0), ('JavaScript', 0), ('CSS', 0)"
            );
            console.log('Created the Choices table');
          }

          // Check if the Log table exists
          const logTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='Log'");
          if (!logTableExists) {
            // Log can start empty - we'll insert a new record whenever the user chooses a poll option
            await db.run(
              "CREATE TABLE Log (id INTEGER PRIMARY KEY AUTOINCREMENT, choice TEXT, time STRING)"
            );
          }

          // Create users table
          await db.run(`
            CREATE TABLE users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              username TEXT UNIQUE NOT NULL,
              password_hash TEXT NOT NULL,
              role TEXT NOT NULL
            )
          `);
          console.log('Created the users table');

          // Create events table
          await db.run(`
            CREATE TABLE events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              date TEXT NOT NULL,
              location TEXT NOT NULL,
              type TEXT NOT NULL,
              custom_fields_schema_json TEXT
            )
          `);
          console.log('Created the events table');

          // Create event_participants table
          await db.run(`
            CREATE TABLE event_participants (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_id INTEGER NOT NULL,
              user_id INTEGER NOT NULL,
              status TEXT NOT NULL,
              custom_field_values_json TEXT,
              FOREIGN KEY (event_id) REFERENCES events(id),
              FOREIGN KEY (user_id) REFERENCES users(id)
            )
          `);
          console.log('Created the event_participants table');

          // Insert default users
          const adminPasswordHash = await bcrypt.hash("admin", 10);
          await db.run(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            ["admin", adminPasswordHash, "admin"]
          );

          const user1PasswordHash = await bcrypt.hash("123456", 10);
          await db.run(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            ["user1", user1PasswordHash, "user"]
          );
          
          const user2PasswordHash = await bcrypt.hash("123456", 10);
          await db.run(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            ["user2", user2PasswordHash, "user"]
          );
          
          const user3PasswordHash = await bcrypt.hash("123456", 10);
          await db.run(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            ["user3", user3PasswordHash, "user"]
          );

          console.log("Database initialized with default tables and users.");
        }

        console.log("Database initialized with default tables and users.");
      } catch (dbError) {
        console.error(dbError);
      }
    });
}

  initializeDatabase();

// Our server script will call these methods to connect to the db
module.exports = {
  /**
   * Get a user by username
   */
  getUserByUsername: async (username) => {
    try {
      return await db.get("SELECT * FROM users WHERE username = ?", username);
    } catch (dbError) {
      console.error(dbError);
    }
  },

  /**
   * Get the options in the database
   */
  getOptions: async () => {
    // We use a try catch block in case of db errors
    try {
      return await db.all("SELECT * from Choices");
    } catch (dbError) {
      console.error(dbError);
    }
  },

  /**
   * Add a new event
   */
  addEvent: async (name, date, location, type, custom_fields_schema_json) => {
    try {
      const result = await db.run(
        "INSERT INTO events (name, date, location, type, custom_fields_schema_json) VALUES (?, ?, ?, ?, ?)",
        [name, date, location, type, custom_fields_schema_json]
      );
      return result.lastID;
    } catch (dbError) {
      console.error(dbError);
    }
  },

  /**
   * Update an existing event
   */
  updateEvent: async (id, name, date, location, type, custom_fields_schema_json) => {
    try {
      const result = await db.run(
        "UPDATE events SET name = ?, date = ?, location = ?, type = ?, custom_fields_schema_json = ? WHERE id = ?",
        [name, date, location, type, custom_fields_schema_json, id]
      );
      return result.changes;
    } catch (dbError) {
      console.error(dbError);
    }
  },

  /**
   * Delete an event and its participants
   */
  deleteEvent: async (id) => {
    try {
      await db.run("DELETE FROM event_participants WHERE event_id = ?", id);
      const result = await db.run("DELETE FROM events WHERE id = ?", id);
      return result.changes;
    } catch (dbError) {
      console.error(dbError);
    }
  },

  /**
   * Get all events
   */
  getAllEvents: async () => {
    try {
      return await db.all("SELECT * FROM events");
    } catch (dbError) {
      console.error(dbError);
    }
  },

  /**
   * Get all participants with event details
   */
  getAllParticipantsWithEventDetails: async () => {
    try {
      return await db.all(`
        SELECT
          ep.id AS participant_id,
          e.name AS event_name,
          e.date AS event_date,
          e.location AS event_location,
          u.username AS participant_username,
          ep.status,
          ep.custom_field_values_json
        FROM event_participants ep
        JOIN events e ON ep.event_id = e.id
        JOIN users u ON ep.user_id = u.id
      `);
    } catch (dbError) {
      console.error(dbError);
    }
  },

  /**
   * Add or update a participant's status for an event
   */
  addOrUpdateParticipant: async (event_id, user_id, status, custom_field_values_json) => {
    try {
      const existingParticipant = await db.get(
        "SELECT * FROM event_participants WHERE event_id = ? AND user_id = ?",
        [event_id, user_id]
      );

      if (existingParticipant) {
        const result = await db.run(
          "UPDATE event_participants SET status = ?, custom_field_values_json = ? WHERE event_id = ? AND user_id = ?",
          [status, custom_field_values_json, event_id, user_id]
        );
        return result.changes;
      } else {
        const result = await db.run(
          "INSERT INTO event_participants (event_id, user_id, status, custom_field_values_json) VALUES (?, ?, ?, ?)",
          [event_id, user_id, status, custom_field_values_json]
        );
        return result.lastID;
      }
    } catch (dbError) {
      console.error(dbError);
    }
  },

  /**
   * Get events a user is participating in
   */
  getParticipantEventsByUserId: async (user_id) => {
    try {
      return await db.all(`
        SELECT
          ep.id AS participant_id,
          e.id AS event_id,
          e.name AS event_name,
          e.date AS event_date,
          e.location AS event_location,
          e.type AS event_type,
          e.custom_fields_schema_json,
          ep.status,
          ep.custom_field_values_json
        FROM event_participants ep
        JOIN events e ON ep.event_id = e.id
        WHERE ep.user_id = ?
      `, user_id);
    } catch (dbError) {
      console.error(dbError);
    }
  },

  /**
   * Process a user vote
   */
  processVote: async vote => {
    // Insert new Log table entry indicating the user choice and timestamp
    try {
      // Check the vote is valid
      const option = await db.all(
        "SELECT * from Choices WHERE language = ?",
        vote
      );
      if (option.length > 0) {
        // Build the user data from the front-end and the current time into the sql query
        await db.run("INSERT INTO Log (choice, time) VALUES (?, ?)", [
          vote,
          new Date().toISOString()
        ]);

        // Update the number of times the choice has been picked by adding one to it
        await db.run(
          "UPDATE Choices SET picks = picks + 1 WHERE language = ?",
          vote
        );
      }

      // Return the choices so far - page will build these into a chart
      return await db.all("SELECT * from Choices");
    } catch (dbError) {
      console.error(dbError);
    }
  },

  /**
   * Get logs
   */
  getLogs: async () => {
    // Return most recent 20
    try {
      // Return the array of log entries to admin page
      return await db.all("SELECT * from Log ORDER BY time DESC LIMIT 20");
    } catch (dbError) {
      console.error(dbError);
    }
  },

  /**
   * Clear logs and reset votes
   */
  clearHistory: async () => {
    try {
      // Delete the logs
      await db.run("DELETE from Log");

      // Reset the vote numbers
      await db.run("UPDATE Choices SET picks = 0");

      // Return empty array
      return [];
    } catch (dbError) {
      console.error(dbError);
    }
  }
};
