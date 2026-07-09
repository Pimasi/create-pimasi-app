#!/bin/bash
set -e

# Start mongod without auth to bootstrap
if [ "${MONGO_LOGS_ENABLED:-false}" = "true" ]; then
  mongod --replSet rs0 --bind_ip_all &
else
  mongod --replSet rs0 --bind_ip_all --quiet --logpath /dev/null &
fi
MONGOD_PID=$!

# Wait for mongod to accept connections
until mongosh --quiet --eval "db.runCommand('ping').ok" >/dev/null 2>&1; do
  sleep 1
done

# Initiate replica set if not already configured
mongosh --quiet --eval '
  try { rs.status() }
  catch(e) { rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "'${RS_HOST:-localhost}:27017'" }] }) }
'

# Wait for primary election
until mongosh --quiet --eval "rs.hello().isWritablePrimary" 2>/dev/null | grep -q true; do
  sleep 1
done

# Create root user if it doesn't exist
mongosh --quiet admin --eval '
  if (db.getUsers().users.length === 0) {
    db.createUser({
      user: "root",
      pwd: "'${MONGO_INITDB_ROOT_PASSWORD:-secret}'",
      roles: [{ role: "root", db: "admin" }]
    });
  }
'

# Bring mongod to the foreground (no auth for dev simplicity)
wait $MONGOD_PID
