# QA de interface

Testes função por função na interface real (renderer compilado), com o processo
principal e o servidor local simulados.

```bash
npx vite build && npx vite preview --port 4173 &
cd qa
npm i axe-core@4.10.2
ffmpeg -f lavfi -i "sine=frequency=110:duration=30" -ac 2 test.mp3
python3 qa.py   # gera qa-results.json e shots/
```
