import os
import shutil
from pathlib import Path


def discover_engines() -> list[dict[str, str | list[str]]]:
    """Bounded discovery in conventional installation roots; never scan whole disks."""
    roots = [Path.cwd() / 'katago', Path.home() / 'KataGo', Path('D:/Katago'), Path('C:/KataGo')]
    if os.getenv('KATAGO_HOME'):
        roots.insert(0, Path(os.environ['KATAGO_HOME']))
    found: dict[str, Path] = {}
    for name in ('katago', 'katago.exe'):
        on_path = shutil.which(name)
        if on_path:
            found[str(Path(on_path).resolve())] = Path(on_path).resolve()
    for root in roots:
        if not root.is_dir():
            continue
        for pattern in ('katago.exe', 'katago', '*/katago.exe', '*/katago', '*/*/katago.exe'):
            for executable in root.glob(pattern):
                if executable.is_file():
                    found[str(executable.resolve())] = executable.resolve()
    return [{'executable': str(exe), 'name': exe.parent.name,
             'models': [str(p) for p in exe.parent.glob('*.bin.gz')] + [str(p) for p in exe.parent.glob('*.txt.gz')],
             'configs': [str(p) for p in exe.parent.glob('*.cfg') if 'analysis' in p.name]}
            for exe in found.values()]
