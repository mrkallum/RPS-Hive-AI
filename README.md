# 🧠 RPS Hive AI

RPS Hive AI is a single-file Python project that simulates a persistent, evolving multi-agent intelligence system using the game Rock–Paper–Scissors.

A population of AI agents learns through self-play, evolves through genetic selection, merges collective knowledge into a central Mother AI, and then trains against a human player via the command line. All learning is saved to disk and persists across runs.

This project explores emergence, evolution, collective intelligence, and human-in-the-loop learning.

---

## ✨ Overview

The system is built around a continuous learning loop:

- Many AIs learn independently through competition  
- Evolution removes weak strategies and mutates strong ones  
- Knowledge converges into a single Mother AI  
- The Mother AI learns directly from a human player  
- Human-influenced knowledge is shared back to the population  
- All progress is stored and reused in future runs  

Nothing resets unless you explicitly delete the memory file.

---

## 🔁 Learning Cycle

1. **Child AIs** play Rock–Paper–Scissors against each other  
2. Each AI learns using reinforcement learning (win = reward, loss = penalty)  
3. **Genetic evolution** selects top performers and mutates their traits  
4. All surviving knowledge is merged into the **Mother AI**  
5. The Mother AI plays against a **human via CLI**  
6. The Mother learns from the human’s behaviour  
7. The learned knowledge is **broadcast back to the children**  
8. The entire system is saved and continues next run  

This creates a closed, persistent intelligence loop:

**Population → Mother → Human → Mother → Population**

---

## 🧬 Key Features

- Multi-agent reinforcement learning  
- Genetic evolution (selection, mutation, reproduction)  
- Knowledge distillation into a central Mother AI  
- Human-in-the-loop training  
- Persistent memory using JSON  
- Single-file Python implementation  
- No external dependencies  

---

## 🎮 Command-Line Controls

During the human vs Mother AI phase:

- `R` → Rock  
- `P` → Paper  
- `S` → Scissors  
- `Q` → Quit  

Input is case-insensitive.

---

## 📁 Persistent Memory

All AI knowledge is stored in:
`ai_memory.json`


This file contains:
- Learned Q-values for every child AI  
- Learning rate and exploration rate (genetic traits)  
- Mother AI knowledge  
- Generation count  

Delete this file to reset the system.  
Keep it to allow intelligence to accumulate over time.

---

## ▶️ How to Run

### Requirements
- Python 3.x

### Steps

1. Clone the repository  
2. Navigate to the project directory  
3. Run:

```bash
python rps_hive_ai.py
```

On first run, a new AI population is created.
On subsequent runs, the system resumes from saved memory.

## 🧪 Why Rock–Paper–Scissors?

Rock–Paper–Scissors is a perfectly balanced game with no dominant strategy.
This makes it ideal for studying:
- Adaptation instead of memorisation
- Population-level intelligence
- Learning dynamics under equilibrium pressure

The architecture is intentionally generic and can be extended to more complex environments.

---

## 🚀 Possible Extensions 
- Replace Q-tables with neural networks
- Track and adapt to individual human playstyles
- Add multiple Mother AIs or competing populations
- Extend to strategy or resource-management games
- Visualise evolution and learning over time

---

## ⚠️ Disclaimer

This project is experimental and educational.
Human behaviour directly influences future generations of AIs.
Poor training persists. Thoughtful training compounds.
