@echo off
rem daily DB backup (every day 07:00 via Task Scheduler, run-when-available)
rem output: OneDrive backup folder backup_daily_YYYYMMDD.sql
rem NOTE: keep this file ASCII-only (cmd.exe breaks on UTF-8 Korean comments)
"C:\Program Files\nodejs\node.exe" "%~dp0db-backup.js" daily
rem retention rotation (policy B, approved 2026-07-26): keep all today / 1 per day within 30d / 1 per week older
"C:\Program Files\nodejs\node.exe" "%~dp0backup-rotate.js" --yes
