import { useState } from 'react';
import { api } from '../api';

export default function CheckoutModal({
  cart,
  cartId,
  close,
  refresh,
  onSuccess
}) {
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState('');
  const [instructions, setInstructions] = useState(false);
  const [receipt, setReceipt] = useState(null);

  const total = cart?.total || 0;

  // ============================================================
  // DOWNLOAD RECEIPT
  // ============================================================

  const downloadReceipt = () => {
    if (!receipt) return;

    const receiptHtml = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Copper & Char Receipt</title>

<style>
  body {
    font-family: Arial, sans-serif;
    background: #f5f5f3;
    padding: 40px;
    color: #222;
  }

  .receipt {
    max-width: 650px;
    margin: auto;
    background: white;
    padding: 40px;
    border-radius: 12px;
    box-shadow: 0 5px 25px rgba(0,0,0,0.08);
  }

  .brand {
    font-size: 26px;
    font-weight: bold;
    margin-bottom: 5px;
  }

  .test {
    color: #777;
    font-size: 12px;
    margin-bottom: 30px;
  }

  h1 {
    margin-bottom: 5px;
  }

  .success {
    color: #5d9f2f;
    font-weight: bold;
    margin-bottom: 30px;
  }

  .row {
    display: flex;
    justify-content: space-between;
    padding: 12px 0;
    border-bottom: 1px solid #eee;
  }

  .total {
    font-size: 22px;
    font-weight: bold;
    margin-top: 20px;
  }

  .footer {
    margin-top: 35px;
    color: #777;
    font-size: 12px;
    text-align: center;
  }
</style>
</head>

<body>

<div class="receipt">

  <div class="brand">
    Copper & Char
  </div>

  <div class="test">
    TEST MODE · PAYMENT RECEIPT
  </div>

  <h1>Payment Successful</h1>

  <div class="success">
    ✓ Payment verified successfully
  </div>

  <div class="row">
    <span>Order ID</span>
    <strong>${receipt.order_id}</strong>
  </div>

  <div class="row">
    <span>Payment ID</span>
    <strong>${receipt.payment_id}</strong>
  </div>

  <div class="row">
    <span>Cart ID</span>
    <strong>${receipt.cart_id}</strong>
  </div>

  <div class="row">
    <span>Date</span>
    <strong>${new Date(receipt.created_at).toLocaleString('en-IN')}</strong>
  </div>

  <div class="row total">
    <span>Total Paid</span>
    <strong>₹${receipt.amount.toLocaleString('en-IN')}</strong>
  </div>

  <div class="footer">
    This is a Razorpay test-mode transaction.
    No real money was charged.
    <br />
    Copper & Char · Commerce Control Room
  </div>

</div>

</body>
</html>
`;

    const blob = new Blob(
      [receiptHtml],
      { type: 'text/html' }
    );

    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');

    link.href = url;

    link.download =
      `copper-char-receipt-${receipt.order_id}.html`;

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  };

  // ============================================================
  // HANDLE FAILED PAYMENT
  // ============================================================

  const fail = async (
    orderId,
    reason = 'Razorpay declined the test payment.'
  ) => {
    try {
      await api('/api/checkout/verify', {
        method: 'POST',

        body: JSON.stringify({
          cart_id: cartId,
          order_id: orderId,
          status: 'failed',
          reason,
        }),
      });

      setState('recovery');

      setMessage(
        'Payment could not be completed'
      );

      setDetail(
        'Your cart is safe — no items were lost. You can try again or select another payment method.'
      );

      await refresh();

    } catch (error) {

      setState('error');

      setMessage(
        'Payment status could not be confirmed'
      );

      // Extract error detail from structured error responses
      let errorDetail = 'Something went wrong while processing the payment result.';
      
      if (error.detail) {
        if (typeof error.detail === 'string') {
          errorDetail = error.detail;
        } else if (typeof error.detail === 'object') {
          if (error.detail.message) {
            errorDetail = error.detail.message;
            if (error.detail.code) {
              errorDetail = `${error.detail.code}: ${errorDetail}`;
            }
          } else if (error.detail.code) {
            errorDetail = error.detail.code;
          } else {
            errorDetail = JSON.stringify(error.detail);
          }
        }
      } else if (error.message) {
        errorDetail = error.message;
      }

      setDetail(errorDetail);
    }
  };

  // ============================================================
  // START RAZORPAY CHECKOUT
  // ============================================================

  const pay = async () => {

    setState('loading');

    setMessage('');
    setDetail('');

    try {

      const response = await api(
        `/api/checkout/${cartId}`,
        {
          method: 'POST',
        }
      );

      const { order, key_id } = response;

      if (!order) {
        throw new Error(
          'The backend did not return a Razorpay order.'
        );
      }

      if (!key_id) {
        throw new Error(
          'Razorpay key ID is missing from the backend response.'
        );
      }

      if (!window.Razorpay) {
        throw new Error(
          'Razorpay Checkout.js was not loaded.'
        );
      }

      const options = {

        key: key_id,

        amount: order.amount,

        currency:
          order.currency || 'INR',

        name: 'Copper & Char',

        description:
          'Test mode order',

        order_id: order.id,

        prefill: {
          name: 'Demo Customer',
          email: 'demo@example.com',
          contact: '9999999999',
        },

        notes: {
          cart_id: cartId,
        },

        theme: {
          color: '#9a6842',
        },

        // ======================================================
        // SUCCESS
        // ======================================================

        handler: async (response) => {

          try {

            setState('loading');

            const verification =
              await api(
                '/api/checkout/verify',
                {
                  method: 'POST',

                  body: JSON.stringify({

                    cart_id: cartId,

                    order_id: order.id,

                    payment_id:
                      response.razorpay_payment_id,

                    signature:
                      response.razorpay_signature,
                  }),
                }
              );

            if (!verification.verified) {

              throw new Error(
                'Payment verification failed.'
              );
            }

            // Save receipt information
            setReceipt(
              verification.receipt
            );

            setState('success');

            setMessage(
              'Payment successful!'
            );

            setDetail(
              'Your payment was verified successfully and your order has been completed.'
            );

            // Refresh cart.
            // Backend has already cleared it.
            await refresh();

            // Call onSuccess callback if provided (for AI Buyer autonomous checkout)
            if (onSuccess && verification.receipt) {
              onSuccess(verification.receipt);
            }

          } catch (error) {

            console.error('Payment verification error:', error);

            setState('error');

            setMessage(
              'Payment verification failed'
            );

            // Extract error detail from structured error responses
            let errorDetail = 'The payment was received, but verification could not be completed. ' +
              'Your payment has been preserved for manual reconciliation.';
            
            if (error.detail) {
              if (typeof error.detail === 'string') {
                errorDetail = error.detail;
              } else if (typeof error.detail === 'object') {
                if (error.detail.message) {
                  errorDetail = error.detail.message;
                  if (error.detail.code) {
                    errorDetail = `${error.detail.code}: ${errorDetail}`;
                  }
                } else if (error.detail.code) {
                  errorDetail = error.detail.code;
                } else {
                  errorDetail = JSON.stringify(error.detail);
                }
              }
            } else if (error.message) {
              errorDetail = error.message;
            }

            setDetail(errorDetail);
          }
        },

        // ======================================================
        // MODAL DISMISSED
        // ======================================================

        modal: {

          ondismiss: () => {

            setState('idle');

          },

        },
      };

      const razorpayCheckout =
        new window.Razorpay(options);

      // ========================================================
      // PAYMENT FAILED
      // ========================================================

      razorpayCheckout.on(
        'payment.failed',
        async (response) => {

          const reason =
            response?.error?.description ||
            response?.error?.reason ||
            'Razorpay declined the test payment.';

          await fail(
            order.id,
            reason
          );
        }
      );

      razorpayCheckout.open();

      setState('idle');

    } catch (error) {

      console.error('Checkout modal error:', error);

      setState('error');

      setMessage(
        'Checkout could not be opened'
      );

      // Extract error detail from structured error responses
      let errorDetail = 'Something went wrong while opening Razorpay Checkout.';
      
      if (error.detail) {
        if (typeof error.detail === 'string') {
          errorDetail = error.detail;
        } else if (typeof error.detail === 'object') {
          // Handle structured error responses from FastAPI
          if (error.detail.message) {
            errorDetail = error.detail.message;
            if (error.detail.code) {
              errorDetail = `${error.detail.code}: ${errorDetail}`;
            }
          } else if (error.detail.code) {
            errorDetail = error.detail.code;
          } else {
            errorDetail = JSON.stringify(error.detail);
          }
        }
      } else if (error.message) {
        errorDetail = error.message;
      } else if (typeof error === 'object') {
        errorDetail = JSON.stringify(error);
      }

      setDetail(errorDetail);
    }
  };

  // ============================================================
  // RESET
  // ============================================================

  const reset = () => {

    setState('idle');

    setMessage('');

    setDetail('');

  };

  // ============================================================
  // SUCCESS SCREEN
  // ============================================================

  if (state === 'success') {

    return (

      <div
        className="modal-backdrop"
        role="dialog"
        aria-modal="true"
      >

        <section
          className="checkout-modal checkout-result-modal"
          onClick={(e) =>
            e.stopPropagation()
          }
        >

          <button
            className="close"
            onClick={close}
            aria-label="Close checkout"
          >
            ×
          </button>

          <div className="checkout-result success">

            <div className="result-icon">
              ✓
            </div>

            <p className="section-kicker">
              ORDER COMPLETED
            </p>

            <h2>
              Payment successful!
            </h2>

            <p>
              {detail}
            </p>

            {receipt && (

              <div className="receipt-summary">

                <div>
                  <span>
                    Order ID
                  </span>

                  <strong>
                    {receipt.order_id}
                  </strong>
                </div>

                <div>
                  <span>
                    Payment ID
                  </span>

                  <strong>
                    {receipt.payment_id}
                  </strong>
                </div>

                <div>
                  <span>
                    Amount Paid
                  </span>

                  <strong>
                    ₹{receipt.amount.toLocaleString('en-IN')}
                  </strong>
                </div>

              </div>

            )}

            <div className="result-actions">

              <button
                className="primary full"
                onClick={downloadReceipt}
              >
                ↓ Download Receipt
              </button>

              <button
                className="secondary full"
                onClick={close}
              >
                Done
              </button>

            </div>

          </div>

        </section>

      </div>

    );
  }

  // ============================================================
  // RECOVERY / ERROR SCREEN
  // ============================================================

  if (
    state === 'recovery' ||
    state === 'error'
  ) {

    return (

      <div
        className="modal-backdrop"
        role="dialog"
        aria-modal="true"
      >

        <section
          className="checkout-modal checkout-result-modal"
          onClick={(e) =>
            e.stopPropagation()
          }
        >

          <button
            className="close"
            onClick={close}
          >
            ×
          </button>

          <div
            className={`checkout-result ${state}`}
          >

            <div className="result-icon">

              {state === 'recovery'
                ? '!'
                : '×'}

            </div>

            <h2>
              {message}
            </h2>

            <p>
              {detail}
            </p>

            <div className="result-actions">

              <button
                className="primary full"
                onClick={pay}
              >
                Try again
              </button>

              <button
                className="secondary full"
                onClick={reset}
              >
                Use another payment method
              </button>

            </div>

          </div>

        </section>

      </div>

    );
  }

  // ============================================================
  // MAIN CHECKOUT SCREEN
  // ============================================================

  return (

    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
    >

      <section
        className="checkout-modal"
        onClick={(e) =>
          e.stopPropagation()
        }
      >

        <button
          className="close"
          onClick={close}
          aria-label="Close checkout"
        >
          ×
        </button>

        <p className="section-kicker">
          Razorpay test checkout
        </p>

        <h2>
          Complete your order
        </h2>

        <p className="modal-total">
          ₹{total.toLocaleString('en-IN')}
        </p>

        <p className="secure-note">
          ● Test mode · secure Razorpay order
        </p>

        <button
          className="primary full"
          onClick={pay}
          disabled={state === 'loading'}
        >
          {state === 'loading'
            ? 'Creating secure order…'
            : 'Open Razorpay Checkout →'}
        </button>

        <div className="test-scenarios">

          <b>
            Test payment scenarios
          </b>

          <p>
            ✓ Complete a successful test payment
            in Razorpay Checkout.
          </p>

          <button
            type="button"
            onClick={() =>
              fail(
                'decline_demo',
                'Demo decline selected — retry is available.'
              )
            }
          >
            ⚠ Simulate declined payment
          </button>

        </div>

        <button
          type="button"
          className="instructions"
          onClick={() =>
            setInstructions(!instructions)
          }
        >
          Test instructions{' '}
          {instructions ? '−' : '+'}
        </button>

        {instructions && (

          <div className="instruction-copy">

            <p>
              Use a Razorpay test card in
              the test checkout.
            </p>

            <code>
              4100 2800 0006 0003
            </code>

            <p>
              Use a future expiry date and
              a test CVV.
            </p>

          </div>

        )}

      </section>

    </div>

  );
}