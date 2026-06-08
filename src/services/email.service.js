const sgMail = require('@sendgrid/mail');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const sendEmail = async (to, subject, text, html) => {
  try {
    const msg = {
      to,
      from: {
        email: process.env.FROM_EMAIL,
        name: process.env.FROM_NAME
      },
      subject,
      text,
      html
    };
    await sgMail.send(msg);
  } catch (error) {
    console.error('Email error:', error.message);
  }
};

module.exports = { sendEmail };
