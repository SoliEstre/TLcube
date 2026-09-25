/**
 * 자식 프로세스를 «총 벽시계» 가 아니라 «진행» 으로 감시한다.
 *
 * 왜 (2026-09-25): 총 벽시계 상한은 자식의 일이 아니라 호스트가 한가한지를 잰다.
 * seq-truth 는 같은 트리·같은 975 프레임이 단독 1,098,141 ms 였는데 부하·절전이 겹친
 * 전수에서 1,800,000 ms 상한에 걸려 죽었다 (09-24 full-013). 시간 상한이 잡아야 하는
 * 것은 «멈춤» 하나이고, 그건 «일 단위가 끝나지 않는 시간» 으로 잰다 — 자식이 일 단위마다
 * 뭔가를 출력한다는 전제에서 «출력 없음» = «진행 없음» 이다.
 *
 * 시계: 경과 ms 가 아니라 setInterval 의 **틱 수**를 센다. Node 의 반복 타이머는 밀린
 * 틱을 몰아 쏘지 않는다 — 루프가 막혔거나 절전에서 깨어나도 콜백은 한 번이다. 그래서
 * 틱 수는 대략 «깨어 있는 시간» 이고, 절전 몇 시간이 «멈춤» 으로 둔갑하지 않는다.
 * 부하로 틱이 늦게 오면 창이 늘어날 뿐 줄지 않는다 — 틀려도 거짓 «멈춤» 쪽으로는 안 틀린다.
 * (이 전제는 test/progress-watchdog.test.js 가 잰다.)
 */
import { spawn } from 'node:child_process';

/**
 * 순수 판정기 — I/O 없이 틱과 진행만 받는다. 테스트가 가상 틱으로 몰 수 있게 떼어 둔다.
 * 연속 무진행 틱이 stallTicks 에 닿는 틱에서 한 번만 «멈춤» 을 낸다.
 */
export function createStallDetector(stallTicks) {
  if (!Number.isSafeInteger(stallTicks) || stallTicks < 1) {
    throw new RangeError(`stallTicks 는 1 이상의 정수여야 한다: ${stallTicks}`);
  }
  let progressed = false;
  let idleTicks = 0;
  let maxIdleTicks = 0;
  let stalled = false;
  return {
    progress() {
      progressed = true;
    },
    /** @returns {boolean} 이 틱에서 멈춤으로 판정됐으면 true (판정은 한 번뿐) */
    tick() {
      if (stalled) return false;
      if (progressed) {
        progressed = false;
        idleTicks = 0;
        return false;
      }
      idleTicks += 1;
      if (idleTicks > maxIdleTicks) maxIdleTicks = idleTicks;
      if (idleTicks >= stallTicks) {
        stalled = true;
        return true;
      }
      return false;
    },
    get stalled() {
      return stalled;
    },
    /** 이 실행에서 본 가장 긴 무진행 연속 틱 — 한도 대비 여유를 보고하는 데 쓴다. */
    get maxIdleTicks() {
      return maxIdleTicks;
    },
  };
}

/**
 * spawn 하고 {@link watchProgress} 로 감시한다.
 */
export function runWithProgressWatchdog(command, args, { cwd, env, tickMs, stallTicks }) {
  validateTiming(tickMs, stallTicks); // 인자가 틀리면 spawn 전에 던진다 — 고아 자식을 안 남긴다.
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return watchProgress(child, { tickMs, stallTicks });
}

function validateTiming(tickMs, stallTicks) {
  if (!Number.isSafeInteger(tickMs) || tickMs < 1) {
    throw new RangeError(`tickMs 는 1 이상의 정수여야 한다: ${tickMs}`);
  }
  createStallDetector(stallTicks);
}

/**
 * stdout·stderr 에 뭔가 오면 진행으로 센다. 멈춤이면 자식을 죽이고 `stalled: true` 로
 * 끝낸다. 총 시간 상한은 **없다** — 꾸준히 진행하는 자식은 멈춘 게 아니다.
 * 기동(첫 출력 전)도 무진행으로 센다 — 출력 전에 멈춘 자식도 잡아야 하므로.
 *
 * @param child ChildProcess 모양 (stdout·stderr 스트림, kill(), 'close'·'error' 이벤트)
 * @returns {Promise<{status:number|null, signal:string|null, stdout:string, stderr:string,
 *   stalled:boolean, ticks:number, maxIdleTicks:number}>}
 */
export function watchProgress(child, { tickMs, stallTicks }) {
  validateTiming(tickMs, stallTicks);
  const detector = createStallDetector(stallTicks);
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let ticks = 0;
    // 청크 경계에서 한글이 쪼개지지 않게 문자열로 받는다.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text) => {
      stdout += text;
      detector.progress();
    });
    child.stderr.on('data', (text) => {
      stderr += text;
      detector.progress();
    });
    const timer = setInterval(() => {
      ticks += 1;
      if (detector.tick()) child.kill();
    }, tickMs);
    child.once('error', (error) => {
      clearInterval(timer);
      reject(error);
    });
    child.once('close', (status, signal) => {
      clearInterval(timer);
      resolve({
        status,
        signal,
        stdout,
        stderr,
        stalled: detector.stalled,
        ticks,
        maxIdleTicks: detector.maxIdleTicks,
      });
    });
  });
}
