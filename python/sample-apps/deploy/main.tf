module "hello-lambda-function" {
  source = "terraform-aws-modules/lambda/aws"

  function_name = var.name
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.8"

  create_package         = false
  local_existing_package = "${path.module}/../build/function.zip"

  memory_size = 384
  timeout     = 20

  layers = collapse([
    var.collector_layer_arn,
    var.sdk_layer_arn
  ])

  environment_variables = {
    AWS_LAMBDA_EXEC_WRAPPER = "/opt/otel-instrument"
  }

  tracing_mode = var.tracing_mode

  attach_policy_statements = true
  policy_statements = {
    s3 = {
      effect = "Allow"
      actions = [
        "s3:ListAllMyBuckets"
      ]
      resources = [
        "*"
      ]
    }
  }
}

module "api-gateway" {
  source = "../../../utils/terraform/api-gateway-proxy"

  name                = var.name
  function_name       = module.hello-lambda-function.this_lambda_function_name
  function_invoke_arn = module.hello-lambda-function.this_lambda_function_invoke_arn
}