import { z } from "zod"
import { Resource } from "@opencode-ai/console-resource"
import { AwsClient } from "aws4fetch"
import { fn } from "./util/fn"

export namespace AWS {
  let client: AwsClient

  const createClient = () => {
    if (!client) {
      client = new AwsClient({
        accessKeyId: Resource.AWS_SES_ACCESS_KEY_ID.value,
        secretAccessKey: Resource.AWS_SES_SECRET_ACCESS_KEY.value,
        region: "us-east-1",
      })
    }
    return client
  }

  export const sendEmail = fn(
    z.object({
      to: z.string(),
      subject: z.string(),
      body: z.string(),
      replyTo: z.string().optional(),
    }),
    async (input) => {
      const res = await createClient().fetch("https://email.us-east-1.amazonaws.com/v2/email/outbound-emails", {
        method: "POST",
        headers: {
          "X-Amz-Target": "SES.SendEmail",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // VOLT: sender rebranded off opencode. NOTE: volt-ai.dev must be a verified SES sender identity before
          // this actually delivers (currently only used by the dormant team-invite flow — Members UI is disabled).
          FromEmailAddress: `Volt <noreply@volt-ai.dev>`,
          Destination: {
            ToAddresses: [input.to],
          },
          ...(input.replyTo && { ReplyToAddresses: [input.replyTo] }),
          Content: {
            Simple: {
              Subject: {
                Charset: "UTF-8",
                Data: input.subject,
              },
              Body: {
                Text: {
                  Charset: "UTF-8",
                  Data: input.body,
                },
                Html: {
                  Charset: "UTF-8",
                  Data: input.body,
                },
              },
            },
          },
        }),
      })
      if (!res.ok) {
        throw new Error(`Failed to send email: ${res.statusText}`)
      }
    },
  )
}
