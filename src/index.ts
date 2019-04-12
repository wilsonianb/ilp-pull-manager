import { EventEmitter } from 'events'
import BigNumber from 'bignumber.js'
import createLogger from 'ilp-logger'
import * as SPSP from 'ilp-protocol-spsp'
import * as lt from 'long-timeout'
import * as moment from 'moment'

interface PullPayment {
  pointer: string
  amount: BigNumber.Value,
  timeout?: number
}

export interface RecurringPull extends PullPayment {
  interval: string
  cycles?: number
  retry?: {
    attempts: number
    interval: string
  }
}

interface TimedPull extends RecurringPull {
  cycle: number
  cycles: number
  timer: NodeJS.Timer
  retries: Map<number, {
    attempts: number
    timer: NodeJS.Timer
  }>
}

interface PullResult {
  totalReceived: string
}

export class IlpPullManager extends EventEmitter {
  protected log: any
  protected recurringPulls: Map<string, TimedPull>

  constructor () {
    super()
    this.log = createLogger(`ilp-pull-manager`)
    this.recurringPulls = new Map()
  }

  private static async pull (pullPayment: PullPayment): Promise<PullResult> {
    return SPSP.pull(require('ilp-plugin')(), {
      pointer: pullPayment.pointer,
      amount: pullPayment.amount
    }, {
      timeout: pullPayment.timeout
    })
  }

  private async pull (id: string): Promise<boolean> {
    const pullPayment = this.recurringPulls.get(id)
    if (pullPayment) {
      try {
        const { totalReceived } = await IlpPullManager.pull(pullPayment)
        this.log.info('payment succeeded. id=%s', id)
        this.emit('paid', id, totalReceived)
        return true
      } catch (e) {
        this.log.debug('payment failed. id=%s', id)
        this.emit('failed', id, (e instanceof SPSP.PaymentError) ? e.totalReceived : 0)
      }
    }
    return false
  }

  private scheduleRetry (id: string, cycle: number): void {
    const recurringPull = this.recurringPulls.get(id)
    if (recurringPull && recurringPull.retry) {
      recurringPull.retries.set(cycle, {
        attempts: recurringPull.retry.attempts,
        timer: lt.setInterval(async () => {
          const retry = recurringPull.retries.get(cycle)
          if (retry) {
            if (await this.pull(id) || --retry.attempts <= 0) {
              lt.clearInterval(retry.timer)
              recurringPull.retries.delete(cycle)
            }
          }
        }, moment.duration(recurringPull.retry.interval).asMilliseconds())
      })
    }
  }

  // TODO: Allow amount in non-local asset
  async startRecurringPull (id: string, pullPayment: RecurringPull): Promise<boolean> {
    if (this.recurringPulls.has(id)) {
      this.log.debug('recurring pull payment already exists. id=%s', id)
      throw new Error('Recurring pull payment already exists')
    }

    if (pullPayment.cycles === undefined) {
      pullPayment.cycles = Infinity
    } else if (pullPayment.cycles < 2) {
      throw new Error('Recurring pull payment cannot have less than 2 cyles')
    }

    this.log.info('start recurring payment. id=%s', id)

    this.recurringPulls.set(id, {
      ...pullPayment,
      cycle: 1,
      cycles: pullPayment.cycles,
      retries: new Map(),
      timer: lt.setInterval(async () => {
        const recurringPull = this.recurringPulls.get(id)
        if (recurringPull) {
          if (++recurringPull.cycle <= recurringPull.cycles) {
            if (!await this.pull(id)) {
              this.scheduleRetry(id, recurringPull.cycle)
            }
            if (recurringPull.cycle === recurringPull.cycles) {
              this.emit('end', id)
            }
          } else if (recurringPull.retries.size === 0) {
            lt.clearInterval(recurringPull.timer)
            this.recurringPulls.delete(id)
          }
        }
      }, moment.duration(pullPayment.interval).asMilliseconds())
    })

    if (await this.pull(id)) {
      return true
    } else {
      this.stopRecurringPull(id)
      return false
    }
  }

  stopRecurringPull (id: string): void {
    this.log.info('stop recurring payment. id=' + id)

    const recurringPull = this.recurringPulls.get(id)
    if (recurringPull) {
      lt.clearInterval(recurringPull.timer)
      for (const retry of recurringPull.retries.values()) {
        lt.clearInterval(retry.timer)
      }
      this.emit('end', id)
      this.recurringPulls.delete(id)
    }
  }

  getRecurringPull (id: string): RecurringPull | undefined {
    return this.recurringPulls.get(id)
  }
}
