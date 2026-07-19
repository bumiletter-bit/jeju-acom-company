@echo off
rem v5.0 stage-5 weekly DB backup (every Mon 07:00 via Task Scheduler)
rem output: OneDrive backup folder backup_weekly_YYYYMMDD.sql
"C:\Program Files\nodejs\node.exe" "%~dp0db-backup.js" weekly
