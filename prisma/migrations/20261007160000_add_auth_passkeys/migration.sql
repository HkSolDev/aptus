CREATE TABLE "AuthPasskey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "publicKey" TEXT NOT NULL,
    "credentialID" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "transports" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aaguid" TEXT,
    CONSTRAINT "AuthPasskey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuthPasskey_credentialID_key" ON "AuthPasskey"("credentialID");
CREATE INDEX "AuthPasskey_userId_idx" ON "AuthPasskey"("userId");
ALTER TABLE "AuthPasskey" ADD CONSTRAINT "AuthPasskey_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
