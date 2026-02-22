import random
import json
import os
import copy

# =========================
# CONFIG
# =========================
POPULATION = 30
GENERATIONS = 10
ROUNDS_PER_GEN = 3000
SURVIVAL_RATE = 0.4
SAVE_FILE = "ai_memory.json"

MOVES = ["rock", "paper", "scissors"]
INPUT_MAP = {"r": "rock", "p": "paper", "s": "scissors"}

# =========================
# CORE LOGIC
# =========================
def outcome(a, b):
    if a == b:
        return 0
    if (a == "rock" and b == "scissors") or \
       (a == "paper" and b == "rock") or \
       (a == "scissors" and b == "paper"):
        return 1
    return -1

# =========================
# CHILD AI
# =========================
class RPS_AI:
    def __init__(self, name, lr, epsilon):
        self.name = name
        self.lr = lr
        self.epsilon = epsilon
        self.q = {m: 0.0 for m in MOVES}
        self.score = 0

    def choose(self):
        if random.random() < self.epsilon:
            return random.choice(MOVES)
        return max(self.q, key=self.q.get)

    def learn(self, move, reward):
        self.q[move] += self.lr * (reward - self.q[move])
        self.score += reward

    def reset(self):
        self.q = {m: 0.0 for m in MOVES}
        self.score = 0

# =========================
# MOTHER AI
# =========================
class MotherAI:
    def __init__(self, q=None, lr=0.05):
        self.q = q if q else {m: 0.0 for m in MOVES}
        self.lr = lr

    def choose(self):
        return max(self.q, key=self.q.get)

    def learn(self, move, reward):
        self.q[move] += self.lr * (reward - self.q[move])

# =========================
# GENETICS
# =========================
def mutate(value, rate=0.1, scale=0.2, min_v=0.001, max_v=1.0):
    if random.random() < rate:
        value += random.uniform(-scale, scale)
    return max(min_v, min(max_v, value))

def reproduce(parent, idx):
    child = copy.deepcopy(parent)
    child.name = f"AI_{idx}"
    child.lr = mutate(parent.lr)
    child.epsilon = mutate(parent.epsilon)
    child.reset()
    return child

# =========================
# KNOWLEDGE MERGE
# =========================
def create_mother_ai(ais):
    mother = MotherAI()
    total = sum(max(ai.score, 0) for ai in ais) + 1e-9

    for move in MOVES:
        mother.q[move] = sum(
            ai.q[move] * (max(ai.score, 0) / total)
            for ai in ais
        )
    return mother

def share_with_children(mother, children, blend=0.3):
    for ai in children:
        for move in MOVES:
            ai.q[move] = (1 - blend) * ai.q[move] + blend * mother.q[move]

# =========================
# HUMAN INTERACTION (CLI)
# =========================
def play_against_human(mother):
    print("\n=== HUMAN vs MOTHER AI ===")
    print("R = Rock | P = Paper | S = Scissors | Q = Quit\n")

    while True:
        user = input("Your move (R/P/S/Q): ").lower().strip()
        if user == "q":
            break
        if user not in INPUT_MAP:
            print("Invalid input.")
            continue

        human = INPUT_MAP[user]
        mother_move = mother.choose()

        print("You:", human, "| Mother:", mother_move)

        r = outcome(mother_move, human)
        if r == 1:
            print("Mother wins.")
        elif r == -1:
            print("You win.")
        else:
            print("Draw.")

        mother.learn(mother_move, r)
        print()

# =========================
# PERSISTENCE
# =========================
def save_state(children, mother, generation):
    data = {
        "generation": generation,
        "mother": {"q": mother.q},
        "children": [
            {
                "name": ai.name,
                "q": ai.q,
                "lr": ai.lr,
                "epsilon": ai.epsilon
            }
            for ai in children
        ]
    }
    with open(SAVE_FILE, "w") as f:
        json.dump(data, f, indent=2)
    print("State saved.")

def load_state():
    if not os.path.exists(SAVE_FILE):
        return None
    with open(SAVE_FILE, "r") as f:
        return json.load(f)

def restore(state):
    children = []
    for data in state["children"]:
        ai = RPS_AI(data["name"], data["lr"], data["epsilon"])
        ai.q = data["q"]
        children.append(ai)
    mother = MotherAI(state["mother"]["q"])
    return children, mother, state["generation"]

# =========================
# MAIN
# =========================
state = load_state()

if state:
    print("Loaded existing memory.")
    ais, mother_ai, generation = restore(state)
else:
    print("No memory found. Creating new world.")
    generation = 0
    ais = [
        RPS_AI(
            f"AI_{i}",
            lr=random.uniform(0.01, 0.3),
            epsilon=random.uniform(0.05, 0.5)
        )
        for i in range(POPULATION)
    ]
    mother_ai = None

# ===== EVOLUTION =====
for g in range(GENERATIONS):
    for _ in range(ROUNDS_PER_GEN):
        random.shuffle(ais)
        for i in range(0, POPULATION - 1, 2):
            a, b = ais[i], ais[i + 1]
            m1, m2 = a.choose(), b.choose()
            r1 = outcome(m1, m2)
            a.learn(m1, r1)
            b.learn(m2, -r1)

    ais.sort(key=lambda x: x.score, reverse=True)
    survivors = ais[:int(POPULATION * SURVIVAL_RATE)]

    print(f"Generation {generation} | Top score: {survivors[0].score:.1f}")

    next_gen = []
    while len(next_gen) < POPULATION:
        next_gen.append(reproduce(random.choice(survivors), len(next_gen)))

    ais = next_gen
    generation += 1

# ===== MOTHER PHASE =====
mother_ai = create_mother_ai(ais)
play_against_human(mother_ai)
share_with_children(mother_ai, ais)

# ===== SAVE =====
save_state(ais, mother_ai, generation)
