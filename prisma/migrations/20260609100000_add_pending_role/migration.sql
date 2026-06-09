-- Add PENDING role for Google self-signups awaiting admin approval
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PENDING';
