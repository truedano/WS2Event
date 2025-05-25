/**
 * This is the main server script that provides the API endpoints
 * The script uses the database helper in /src
 * The endpoints retrieve, update, and return data to the page handlebars files
 *
 * The API returns the front-end UI handlebars pages, or
 * Raw json if the client requests it with a query parameter ?raw=json
 */

// Utilities we need
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt"); // For password hashing

// Require the fastify framework and instantiate it
const fastify = require("fastify")({
  // Set this to true for detailed logging:
  logger: false,
});

// Setup our static files
fastify.register(require("@fastify/static"), {
  root: path.join(__dirname, "public"),
  prefix: "/", // optional: default '/'
});

// Formbody lets us parse incoming forms
fastify.register(require("@fastify/formbody"));

// Add cookie and session support
fastify.register(require("@fastify/cookie"));
fastify.register(require("@fastify/session"), {
  secret: process.env.SESSION_SECRET || "a secret with minimum length of 32 characters", // Use a strong secret from environment variables
  cookie: {
    secure: process.env.NODE_ENV === "production", // Set to true in production for HTTPS
    maxAge: 3600000, // Session expiry in milliseconds (1 hour)
  },
  saveUninitialized: false,
  cookieName: "sessionId",
});

// View is a templating manager for fastify
fastify.register(require("@fastify/view"), {
  engine: {
    handlebars: require("handlebars"),
  },
});

// Load and parse SEO data
const seo = require("./src/seo.json");
if (seo.url === "glitch-default") {
  seo.url = `https://${process.env.PROJECT_DOMAIN}.glitch.me`;
}

// We use a module for handling database operations in /src
const data = require("./src/data.json");
const db = require("./src/" + data.database); // This will now include the new methods

// Authentication hook
fastify.addHook("onRequest", async (request, reply) => {
  const publicRoutes = ["/", "/login", "/logout"]; // Routes that don't require authentication
  if (!publicRoutes.includes(request.routeOptions.url) && !request.session.user) {
    reply.redirect("/"); // Redirect to login if not authenticated
  }
});

// Authorization hook
fastify.decorate("authorize", function (roles) {
  return async (request, reply) => {
    if (!request.session.user || !roles.includes(request.session.user.role)) {
      reply.status(403).send("Forbidden: You do not have permission to access this page.");
    }
  };
});

/**
 * Home route for the app
 *
 * Return the poll options from the database helper script
 * The home route may be called on remix in which case the db needs setup
 *
 * Client can request raw data using a query parameter
 */
fastify.get("/", async (request, reply) => {
  /* 
  Params is the data we pass to the client
  - SEO values for front-end UI but not for raw data
  */
  let params = request.query.raw ? {} : { seo: seo };

  // Get the available choices from the database
  const options = await db.getOptions();
  if (options) {
    params.optionNames = options.map((choice) => choice.language);
    params.optionCounts = options.map((choice) => choice.picks);
  }
  // Let the user know if there was a db error
  else params.error = data.errorMessage;

  // Check in case the data is empty or not setup yet
  if (options && params.optionNames.length < 1)
    params.setup = data.setupMessage;

  // ADD PARAMS FROM TODO HERE

  // Send the page options or raw JSON data if the client requested it
  return request.query.raw
    ? reply.send(params)
    : reply.view("/src/pages/index.hbs", params);
});

/**
* Login route
* Handles POST requests from the login form.
* Validates username and password against hashed passwords in the database.
* Creates a session on successful validation and redirects based on user role.
* Redirects back to login page with an error message on failure.
*/
fastify.post("/login", async (request, reply) => {
 const { username, password } = request.body;
 const user = await db.getUserByUsername(username);

 if (user && (await bcrypt.compare(password, user.password_hash))) {
   // Authentication successful
   request.session.user = {
     user_id: user.id,
     username: user.username,
     role: user.role,
   };

   if (user.role === "admin") {
     reply.redirect("/admin");
   } else {
     reply.redirect("/user"); // Or "/" if no specific user page
   }
 } else {
   // Authentication failed
   reply.view("/src/pages/index.hbs", {
     seo: seo,
     error: "Invalid username or password",
   });
 }
});

/**
* Logout route
* Destroys the user session and redirects to the login page.
*/
fastify.get("/logout", async (request, reply) => {
 request.session.destroy((err) => {
   if (err) {
     console.error("Error destroying session:", err);
   }
   reply.redirect("/");
 });
});

/**
 * Post route to process user vote
 *
 * Retrieve vote from body data
 * Send vote to database helper
 * Return updated list of votes
 */
fastify.post("/", async (request, reply) => {
  // We only send seo if the client is requesting the front-end ui
  let params = request.query.raw ? {} : { seo: seo };

  // Flag to indicate we want to show the poll results instead of the poll form
  params.results = true;
  let options;

  // We have a vote - send to the db helper to process and return results
  if (request.body.language) {
    options = await db.processVote(request.body.language);
    if (options) {
      // We send the choices and numbers in parallel arrays
      params.optionNames = options.map((choice) => choice.language);
      params.optionCounts = options.map((choice) => choice.picks);
    }
  }
  params.error = options ? null : data.errorMessage;

  // Return the info to the client
  return request.query.raw
    ? reply.send(params)
    : reply.view("/src/pages/index.hbs", params);
});

/**
 * Admin endpoint returns log of votes
 *
 * Send raw json or the admin handlebars page
 */
fastify.get("/admin", { onRequest: [fastify.authorize(["admin"])] }, async (request, reply) => {
  let params = request.query.raw ? {} : { seo: seo };

  try {
    // Get all events
    params.events = await db.getAllEvents();
    // Get all participants with event details
    params.allParticipants = await db.getAllParticipantsWithEventDetails();
  } catch (error) {
    console.error("Error fetching admin data:", error);
    params.error = data.errorMessage;
  }

  // Send the data to the admin page
  return request.query.raw
    ? reply.send(params)
    : reply.view("/src/pages/admin.hbs", params);
});

// Admin: Add new event
fastify.post("/admin/events", { onRequest: [fastify.authorize(["admin"])] }, async (request, reply) => {
  const { name, date, location, type, custom_fields_schema_json } = request.body;
  try {
    const eventId = await db.addEvent(name, date, location, type, custom_fields_schema_json);
    return reply.send({ success: true, eventId: eventId });
  } catch (error) {
    console.error("Error adding event:", error);
    return reply.status(500).send({ success: false, message: "Failed to add event." });
  }
});

// Admin: Update event
fastify.put("/admin/events/:id", { onRequest: [fastify.authorize(["admin"])] }, async (request, reply) => {
  const { id } = request.params;
  const { name, date, location, type, custom_fields_schema_json } = request.body;
  try {
    const changes = await db.updateEvent(id, name, date, location, type, custom_fields_schema_json);
    if (changes > 0) {
      return reply.send({ success: true, message: "Event updated successfully." });
    } else {
      return reply.status(404).send({ success: false, message: "Event not found or no changes made." });
    }
  } catch (error) {
    console.error("Error updating event:", error);
    return reply.status(500).send({ success: false, message: "Failed to update event." });
  }
});

// Admin: Delete event
fastify.delete("/admin/events/:id", { onRequest: [fastify.authorize(["admin"])] }, async (request, reply) => {
  const { id } = request.params;
  try {
    const changes = await db.deleteEvent(id);
    if (changes > 0) {
      return reply.send({ success: true, message: "Event deleted successfully." });
    } else {
      return reply.status(404).send({ success: false, message: "Event not found." });
    }
  } catch (error) {
    console.error("Error deleting event:", error);
    return reply.status(500).send({ success: false, message: "Failed to delete event." });
  }
});


/**
 * Admin endpoint to empty all logs
 *
 * Requires authorization (see setup instructions in README)
 * If auth fails, return a 401 and the log list
 * If auth is successful, empty the history
 */
fastify.post("/reset", { onRequest: [fastify.authorize(["admin"])] }, async (request, reply) => {
  let params = request.query.raw ? {} : { seo: seo };


  /*
  Authenticate the user request by checking against the env key variable
  - make sure we have a key in the env and body, and that they match
  */
  if (
    !request.body.key ||
    request.body.key.length < 1 ||
    !process.env.ADMIN_KEY ||
    request.body.key !== process.env.ADMIN_KEY
  ) {
    console.error("Auth fail");

    // Auth failed, return the log data plus a failed flag
    params.failed = "You entered invalid credentials!";

    // Get the log list
    params.optionHistory = await db.getLogs();
  } else {
    // We have a valid key and can clear the log
    params.optionHistory = await db.clearHistory();

    // Check for errors - method would return false value
    params.error = params.optionHistory ? null : data.errorMessage;
  }

  // Send a 401 if auth failed, 200 otherwise
  const status = params.failed ? 401 : 200;
  // Send an unauthorized status code if the user credentials failed
  return request.query.raw
    ? reply.status(status).send(params)
    : reply.status(status).view("/src/pages/admin.hbs", params);
});


// User: Get all events for user view
fastify.get("/user", { onRequest: [fastify.authorize(["user"])] }, async (request, reply) => {
  let params = request.query.raw ? {} : { seo: seo };
  try {
    params.events = await db.getAllEvents();
    params.user = request.session.user; // Pass user info to template
  } catch (error) {
    console.error("Error fetching user events:", error);
    params.error = data.errorMessage;
  }
  return request.query.raw
    ? reply.send(params)
    : reply.view("/src/pages/user.hbs", params);
});

// User: Participate in an event (add/update)
fastify.post("/user/participate", { onRequest: [fastify.authorize(["user"])] }, async (request, reply) => {
  const { event_id, status, custom_field_values_json } = request.body;
  const user_id = request.session.user.user_id;
  try {
    const result = await db.addOrUpdateParticipant(event_id, user_id, status, custom_field_values_json);
    return reply.send({ success: true, result: result });
  } catch (error) {
    console.error("Error adding/updating participant:", error);
    return reply.status(500).send({ success: false, message: "Failed to update participation." });
  }
});

// User: Get user's own participations
fastify.get("/user/my-participations", { onRequest: [fastify.authorize(["user"])] }, async (request, reply) => {
  let params = request.query.raw ? {} : { seo: seo };
  const user_id = request.session.user.user_id;
  try {
    params.myParticipations = await db.getParticipantEventsByUserId(user_id);
    params.user = request.session.user; // Pass user info to template
  } catch (error) {
    console.error("Error fetching user participations:", error);
    params.error = data.errorMessage;
  }
  return request.query.raw
    ? reply.send(params)
    : reply.view("/src/pages/user.hbs", params);
});


// Run the server and report out to the logs
fastify.listen(
  { port: process.env.PORT, host: "0.0.0.0" },
  function (err, address) {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Your app is listening on ${address}`);
  }
);
