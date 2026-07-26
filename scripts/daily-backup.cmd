@echo off
rem daily DB backup (every day 07:00 via Task Scheduler, run-when-available)
rem output: OneDrive backup folder backup_daily_YYYYMMDD.sql
rem NOTE: keep this file ASCII-only (cmd.exe breaks on UTF-8 Korean comments)
rem replaced weekly task 2026-07-26 (old task had unquoted path bug) - see docs/DB\bok-gu-jeol-cha.md
"C:\Program Files\nodejs\node.exe" "%~dp0db-backup.js" daily
rem rotation: enable after first manual review (uncomment next line)
rem "C:\Program Files\nodejs\node.exe" "%~dp0backup-rotate.js" --yes
