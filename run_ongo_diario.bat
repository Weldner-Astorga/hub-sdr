@echo off
cd /d "C:\Users\Dell"
python run_ongo_once.py >> "C:\Users\Dell\ongo_cron.log" 2>&1
python fechamento_ongo_diario.py >> "C:\Users\Dell\ongo_cron.log" 2>&1
