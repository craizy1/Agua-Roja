@echo off
title Aguja Roja - Servidor Local de Mastering
echo Iniciando Aguja Roja en http://127.0.0.1:8080 ...
echo (Deja esta ventana abierta mientras usas la pagina; cierrala al terminar)
start "" http://127.0.0.1:8080
python -m http.server 8080 --bind 127.0.0.1
pause
