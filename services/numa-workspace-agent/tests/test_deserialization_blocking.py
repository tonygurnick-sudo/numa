import pytest
from numa_workspace_agent.hooks.security import check_bash_command

BLOCKED_SNIPPETS = [
    "import pickle; pickle.load(open('/workdir/uploads/a.pkl', 'rb'))",
    "import pickle; pickle.loads(b'data')",
    "import pickle; pickle.Unpickler(open('/workdir/uploads/a.pkl', 'rb')).load()",
    "import pandas as pd; pd.read_pickle('/workdir/uploads/a.pkl')",
    "from pandas import read_pickle; read_pickle('/workdir/uploads/a.pkl')",
    "import shelve; shelve.open('/workdir/uploads/cache.db')",
    "import dill; dill.loads(b'data')",
    "import cloudpickle; cloudpickle.load(open('/workdir/uploads/a.pkl', 'rb'))",
    "import joblib; joblib.load('/workdir/uploads/a.pkl')",
    "from joblib import load; load('/workdir/uploads/a.pkl')",
]


SAFE_SNIPPETS = [
    "import pandas as pd; pd.read_csv('/workdir/uploads/data.csv')",
    "import pandas as pd; frame = pd.DataFrame({'x': [1, 2]}); frame.to_csv('/workdir/outputs/out.csv', index=False)",
    "import numpy as np; arr = np.array([1, 2, 3]); print(arr.mean())",
    "with open('/workdir/outputs/notes.txt', 'w') as f: f.write('ok')",
]


@pytest.mark.parametrize("snippet", BLOCKED_SNIPPETS)
def test_security_hook_blocks_unsafe_deserialization(snippet: str) -> None:
    command = f'python3 -c "{snippet}"'
    blocked, reason = check_bash_command(command)

    assert blocked is True
    assert reason is not None


@pytest.mark.parametrize("snippet", SAFE_SNIPPETS)
def test_security_hook_keeps_safe_data_operations(snippet: str) -> None:
    command = f'python3 -c "{snippet}"'
    blocked, reason = check_bash_command(command)

    assert blocked is False
    assert reason is None
