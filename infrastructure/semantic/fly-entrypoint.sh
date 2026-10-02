#!/bin/sh
set -eu

if [ "${1:-}" = --isolated ]; then
  shift
  mount --make-rprivate /
  mount -t cgroup2 cgroup2 /sys/fs/cgroup
  mount -o remount,ro /sys/fs/cgroup
  mount -o remount,ro /
  exec setpriv --reuid=1000 --regid=1000 --clear-groups \
    --bounding-set=-all --inh-caps=-all --ambient-caps=-all \
    --no-new-privs "$@"
fi

: "${FLY_MACHINE_ID:?This entrypoint requires a dedicated Fly Machine}"
: "${ZOEN_SEMANTIC_TOKEN:?The executor authentication token is required}"

# Fly's legacy init mounts these controllers in v1. This dedicated VM has no
# other application process; release just these controllers for our v2 group.
for controller in memory pids; do
  if mountpoint -q "/sys/fs/cgroup/$controller"; then
    umount "/sys/fs/cgroup/$controller"
  fi
done

# Controller release after unmount completes asynchronously in the kernel.
attempt=0
until grep -qw memory /sys/fs/cgroup/unified/cgroup.controllers &&
      grep -qw pids /sys/fs/cgroup/unified/cgroup.controllers; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 50 ]; then
    echo 'Memory and process controllers are unavailable.' >&2
    exit 1
  fi
  sleep 0.1
done

group=/sys/fs/cgroup/unified/zoen-semantic
printf '+memory +pids\n' > /sys/fs/cgroup/unified/cgroup.subtree_control
mkdir -p "$group"
printf '1610612736\n' > "$group/memory.max"
printf '0\n' > "$group/memory.swap.max"
printf '64\n' > "$group/pids.max"
printf '%s\n' "$$" > "$group/cgroup.procs"
exec unshare --mount --cgroup "$0" --isolated "$@"
