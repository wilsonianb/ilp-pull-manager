# ILP Pull Payment Manager

## Description

Handles recurring Interledger pull payments.

## Example

Start recurring pull payment.

```ts
// import {IlpPullManager} from 'ilp-pull-manager'
const pullManager = new IlpPullManager()

this.pullManager.on('paid', (id: string, totalReceived: string) => {
  console.log(`Pull payment succeeded. Received "${totalReceived}"`)
})

this.pullManager.on('failed', (id: string, totalReceived: string) => {
  console.log(`Pull payment failed. Received "${totalReceived}"`)
})

await pullManager.startRecurringPull('myId', {
  pointer: '$bob.example.com/4139fb24-3ab6-4ea1-a6de-e8d761ff7569',
  amount: '1000',
  interval: 'P1M',  // 1 month
  cycles: 12,
  retry: {
    attempts: 3,
    interval: 'P1D' // 1 day
  }
})
```

Stop recurring pull payment.

```ts
pullManager.stopRecurringPull('myId')
```
